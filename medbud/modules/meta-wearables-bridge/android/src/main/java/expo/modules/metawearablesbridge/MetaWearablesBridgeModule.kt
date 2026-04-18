package expo.modules.metawearablesbridge

import android.app.Activity
import android.graphics.Bitmap
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import com.meta.wearable.dat.camera.Stream
import com.meta.wearable.dat.camera.addStream
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamSessionState
import com.meta.wearable.dat.camera.types.VideoFrame
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.session.Session
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.core.types.RegistrationState
import com.meta.wearable.dat.mockdevice.MockDeviceKit
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

class MetaWearablesBridgeModule : Module() {
  private val tag = "MetaWearablesBridge"
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val deviceSelector = AutoDeviceSelector()
  private val permissionMutex = Mutex()

  private var session: Session? = null
  private var stream: Stream? = null
  private var registrationJob: Job? = null
  private var devicesJob: Job? = null
  private var sessionJob: Job? = null
  private var streamStateJob: Job? = null
  private var videoFrameJob: Job? = null
  private var streamErrorJob: Job? = null
  private var wearablesPermissionLauncher: ActivityResultLauncher<Permission>? = null
  private var permissionPromise: kotlin.coroutines.Continuation<PermissionStatus>? = null
  private var latestFrame: Map<String, Any?>? = null
  private var latestAudio: Map<String, Any?>? = null

  private var status = mutableMapOf<String, Any?>(
      "sdkPresent" to true,
      "repoConfigured" to BuildConfig.META_WEARABLES_REPO_CONFIGURED,
      "applicationIdConfigured" to BuildConfig.META_WEARABLES_APPLICATION_ID_CONFIGURED,
      "platformSupported" to true,
      "availability" to false,
      "authorizationStatus" to "unknown",
      "connectionState" to initialConnectionState(),
      "capabilities" to mapOf(
          "video" to true,
          "audio" to false,
          "playback" to false,
      ),
      "runtimeOrigin" to if (BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE) "mock_device" else "none",
      "mockDeviceEnabled" to BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE,
      "lastError" to initialError(),
      "lastConnectionAttemptAt" to null,
      "lastFrameAt" to null,
      "lastAudioAt" to null,
  )

  override fun definition() = ModuleDefinition {
    Name("MetaWearablesBridge")

    Events(
        "statusChanged",
        "frameReceived",
        "audioReceived",
        "error",
    )

    AsyncFunction("initialize") {
      initializeBridge()
      status.toMap()
    }

    AsyncFunction("isAvailable") {
      initializeBridge()
      (status["availability"] as? Boolean) == true
    }

    AsyncFunction("connectToGlasses") {
      initializeBridge()
      connectToGlassesInternal()
    }

    AsyncFunction("disconnectFromGlasses") {
      disconnectInternal()
    }

    AsyncFunction("startVideoCapture") { intervalMs: Int ->
      initializeBridge()
      startVideoCaptureInternal(intervalMs)
    }

    AsyncFunction("stopVideoCapture") {
      stopVideoCaptureInternal()
    }

    AsyncFunction("startAudioCapture") {
      emitUnsupportedAudio()
    }

    AsyncFunction("stopAudioCapture") {
      latestAudio
    }

    AsyncFunction("getLatestFrame") {
      latestFrame
    }

    AsyncFunction("getLatestAudio") {
      latestAudio
    }

    AsyncFunction("getConnectionState") {
      status["connectionState"] as String
    }

    AsyncFunction("getStatus") {
      status.toMap()
    }

    OnDestroy {
      disconnectInternal()
      scope.coroutineContext.cancel()
    }
  }

  private fun initialConnectionState(): String {
    if (!BuildConfig.META_WEARABLES_REPO_CONFIGURED) {
      return "repo_not_configured"
    }
    if (!BuildConfig.META_WEARABLES_APPLICATION_ID_CONFIGURED) {
      return "app_id_missing"
    }
    return "disconnected"
  }

  private fun initialError(): String? {
    if (!BuildConfig.META_WEARABLES_REPO_CONFIGURED) {
      return "GitHub Packages credentials are missing. Set GITHUB_TOKEN or github_token in local.properties."
    }
    if (!BuildConfig.META_WEARABLES_APPLICATION_ID_CONFIGURED) {
      return "META_WEARABLES_APP_ID is not configured for this build."
    }
    return null
  }

  private fun initializeBridge() {
    val activity = appContext.currentActivity ?: return
    ensurePermissionLauncher(activity)
    if (BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE) {
      MockDeviceKit.getInstance(activity.applicationContext).enable()
      updateStatus(
          runtimeOrigin = "mock_device",
          connectionState = if ((status["connectionState"] as? String) == "disconnected") "partial_capability" else null,
      )
    }
    if ((status["connectionState"] as? String) in listOf("repo_not_configured", "app_id_missing")) {
      emitStatus()
      return
    }
    Wearables.initialize(activity)
    startMonitoring()
    updateStatus(
        availability = true,
        authorizationStatus = "pending",
        connectionState = "available",
        lastError = status["lastError"] as? String,
    )
  }

  private fun ensurePermissionLauncher(activity: Activity) {
    val componentActivity = activity as? ComponentActivity ?: return
    if (wearablesPermissionLauncher != null) {
      return
    }
    wearablesPermissionLauncher =
        componentActivity.activityResultRegistry.register(
            "metaWearablesPermission-${UUID.randomUUID()}",
            Wearables.RequestPermissionContract(),
        ) { result ->
          val permissionStatus = result.getOrDefault(PermissionStatus.Denied)
          permissionPromise?.resume(permissionStatus)
          permissionPromise = null
        }
  }

  private fun startMonitoring() {
    if (registrationJob != null || devicesJob != null) {
      return
    }

    registrationJob =
        scope.launch {
          Wearables.registrationState.collect { registrationState ->
            when (registrationState) {
              is RegistrationState.Registered -> {
                updateStatus(
                    availability = true,
                    authorizationStatus = "authorized",
                    connectionState = "connected",
                    runtimeOrigin =
                        if (BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE) "mock_device" else "real_hardware",
                    lastError = null,
                )
              }
              is RegistrationState.Registering -> {
                updateStatus(
                    availability = true,
                    authorizationStatus = "pending",
                    connectionState = "connecting",
                )
              }
              is RegistrationState.Unavailable -> {
                updateStatus(
                    availability = false,
                    authorizationStatus = "pending",
                    connectionState = "developer_mode_required",
                    lastError = "Meta DAT is unavailable. Verify Developer Mode and DAT app registration.",
                )
              }
              is RegistrationState.Unregistered -> {
                updateStatus(
                    availability = true,
                    authorizationStatus = "pending",
                    connectionState = "device_not_authorized",
                    lastError = "Meta glasses are not authorized for this app yet.",
                )
              }
              is RegistrationState.Unregistering -> {
                updateStatus(
                    availability = true,
                    authorizationStatus = "pending",
                    connectionState = "disconnected",
                )
              }
            }
          }
        }

    devicesJob =
        scope.launch {
          Wearables.devices.collect { devices ->
            val hasDevices = devices.isNotEmpty()
            updateStatus(
                availability = hasDevices || BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE,
                connectionState =
                    when {
                      (status["connectionState"] as? String) == "streaming_video" -> null
                      hasDevices -> "connected"
                      else -> "available"
                    },
            )
          }
        }
  }

  private suspend fun connectToGlassesInternal(): Boolean {
    updateStatus(lastConnectionAttemptAt = isoNow())

    if (!BuildConfig.META_WEARABLES_REPO_CONFIGURED) {
      updateStatus(connectionState = "repo_not_configured")
      return false
    }
    if (!BuildConfig.META_WEARABLES_APPLICATION_ID_CONFIGURED) {
      updateStatus(connectionState = "app_id_missing")
      return false
    }

    val activity = appContext.currentActivity
    if (activity == null) {
      updateStatus(
          connectionState = "failed",
          lastError = "No active Android activity is available for DAT registration.",
      )
      return false
    }

    ensurePermissionLauncher(activity)
    Wearables.startRegistration(activity)
    updateStatus(
        availability = true,
        authorizationStatus = "pending",
        connectionState = "connecting",
        runtimeOrigin =
            if (BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE) "mock_device" else status["runtimeOrigin"] as String,
    )
    return true
  }

  private suspend fun startVideoCaptureInternal(intervalMs: Int) {
    if ((status["connectionState"] as? String) in listOf("repo_not_configured", "app_id_missing")) {
      return
    }

    val permissionStatus = requestWearablesCameraPermission()
    if (permissionStatus != PermissionStatus.Granted) {
      updateStatus(
          authorizationStatus = "pending",
          connectionState = "device_not_authorized",
          lastError = "Wearables camera permission was not granted.",
      )
      return
    }

    stopVideoCaptureInternal()

    var createdSession: Session? = null
    Wearables.createSession(deviceSelector)
        .onSuccess { sessionResult ->
          createdSession = sessionResult
        }
        .onFailure { error, _ ->
          updateStatus(
              connectionState = "failed",
              lastError = error.description,
          )
        }

    if (createdSession == null) {
      return
    }

    session = createdSession
    session?.start()

    sessionJob =
        scope.launch {
          session?.state?.collect { sessionState ->
            if (sessionState == DeviceSessionState.STARTED) {
              val addedStream =
                  session
                      ?.addStream(StreamConfiguration(VideoQuality.MEDIUM, intervalMs.coerceAtLeast(1)))
                      ?.let { streamResult ->
                        var createdStream: Stream? = null
                        streamResult
                            .onSuccess { result ->
                              createdStream = result
                            }
                            .onFailure { error, _ ->
                              updateStatus(
                                  connectionState = "failed",
                                  lastError = error.description,
                              )
                            }
                        createdStream
                      } ?: return@collect

              stream = addedStream
              attachStreamCollectors(addedStream)
              addedStream.start()
            }
          }
        }
  }

  private fun attachStreamCollectors(activeStream: Stream) {
    streamStateJob?.cancel()
    videoFrameJob?.cancel()
    streamErrorJob?.cancel()

    streamStateJob =
        scope.launch {
          activeStream.state.collect { streamState ->
            val connectionState =
                when (streamState) {
                  StreamSessionState.STREAMING -> "streaming_video"
                  StreamSessionState.STARTING -> "connecting"
                  StreamSessionState.CLOSED -> "connected"
                  else -> "connected"
                }
            updateStatus(connectionState = connectionState)
          }
        }

    videoFrameJob =
        scope.launch {
          activeStream.videoStream.collect { frame ->
            handleVideoFrame(frame)
          }
        }

    streamErrorJob =
        scope.launch {
          activeStream.errorStream.collect { error ->
            updateStatus(
                connectionState = "failed",
                lastError = error.description,
            )
            emitError(error.description)
          }
        }
  }

  private suspend fun requestWearablesCameraPermission(): PermissionStatus {
    val permissionResult = Wearables.checkPermissionStatus(Permission.CAMERA)
    var existingStatus: PermissionStatus? = null
    var hadFailure = false
    permissionResult
        .onSuccess { status ->
          existingStatus = status
        }
        .onFailure { error, _ ->
          hadFailure = true
          updateStatus(
              connectionState = "failed",
              lastError = "DAT camera permission check failed: ${error.description}",
          )
        }

    if (hadFailure) {
      return PermissionStatus.Denied
    }
    if (existingStatus == PermissionStatus.Granted) {
      return PermissionStatus.Granted
    }

    return permissionMutex.withLock {
      suspendCancellableCoroutine { continuation ->
        permissionPromise = continuation
        continuation.invokeOnCancellation { permissionPromise = null }
        wearablesPermissionLauncher?.launch(Permission.CAMERA)
            ?: continuation.resume(PermissionStatus.Denied)
      }
    }
  }

  private fun handleVideoFrame(videoFrame: VideoFrame) {
    val bitmap = YuvToBitmapConverter.convert(videoFrame.buffer, videoFrame.width, videoFrame.height)
    if (bitmap == null) {
      Log.w(tag, "Failed to convert DAT frame to bitmap.")
      return
    }

    val uri = persistBitmap(bitmap)
    val capturedAt = isoNow()
    latestFrame =
        mapOf(
            "uri" to uri,
            "capturedAt" to capturedAt,
            "width" to videoFrame.width,
            "height" to videoFrame.height,
            "source" to "meta_glasses",
        )
    updateStatus(
        connectionState = "streaming_video",
        lastFrameAt = capturedAt,
        runtimeOrigin =
            if (BuildConfig.META_WEARABLES_ENABLE_MOCK_DEVICE) "mock_device" else "real_hardware",
    )
    sendEvent("frameReceived", latestFrame)
  }

  private fun persistBitmap(bitmap: Bitmap): String {
    val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
    val outputFile = File(context.cacheDir, "meta-frame-${System.currentTimeMillis()}.jpg")
    FileOutputStream(outputFile).use { output ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, 80, output)
    }
    return "file://${outputFile.absolutePath}"
  }

  private fun emitUnsupportedAudio() {
    updateStatus(
        connectionState =
            if ((status["connectionState"] as? String) == "streaming_video") {
              "partial_capability"
            } else {
              status["connectionState"] as? String
            },
        lastError = "Meta DAT Android audio capture is not wired in this build. Phone audio fallback remains active.",
    )
    emitError("Meta DAT Android audio capture is not supported in this build.")
  }

  private fun stopVideoCaptureInternal() {
    videoFrameJob?.cancel()
    videoFrameJob = null
    streamStateJob?.cancel()
    streamStateJob = null
    streamErrorJob?.cancel()
    streamErrorJob = null
    sessionJob?.cancel()
    sessionJob = null
    stream?.stop()
    stream = null
    session?.stop()
    session = null
    if ((status["connectionState"] as? String) == "streaming_video") {
      updateStatus(connectionState = "connected")
    }
  }

  private fun disconnectInternal() {
    stopVideoCaptureInternal()
    updateStatus(connectionState = "disconnected")
  }

  private fun updateStatus(
      sdkPresent: Boolean? = null,
      repoConfigured: Boolean? = null,
      applicationIdConfigured: Boolean? = null,
      platformSupported: Boolean? = null,
      availability: Boolean? = null,
      authorizationStatus: String? = null,
      connectionState: String? = null,
      runtimeOrigin: String? = null,
      lastError: String? = null,
      lastConnectionAttemptAt: String? = null,
      lastFrameAt: String? = null,
      lastAudioAt: String? = null,
  ) {
    sdkPresent?.let { status["sdkPresent"] = it }
    repoConfigured?.let { status["repoConfigured"] = it }
    applicationIdConfigured?.let { status["applicationIdConfigured"] = it }
    platformSupported?.let { status["platformSupported"] = it }
    availability?.let { status["availability"] = it }
    authorizationStatus?.let { status["authorizationStatus"] = it }
    connectionState?.let { status["connectionState"] = it }
    runtimeOrigin?.let { status["runtimeOrigin"] = it }
    status["lastError"] = lastError
    lastConnectionAttemptAt?.let { status["lastConnectionAttemptAt"] = it }
    lastFrameAt?.let { status["lastFrameAt"] = it }
    lastAudioAt?.let { status["lastAudioAt"] = it }
    emitStatus()
  }

  private fun emitStatus() {
    sendEvent("statusChanged", status.toMap())
  }

  private fun emitError(message: String) {
    sendEvent(
        "error",
        mapOf(
            "message" to message,
        ),
    )
  }

  private fun isoNow(): String = java.time.Instant.now().toString()
}
