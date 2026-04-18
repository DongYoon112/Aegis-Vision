import { StyleSheet, Text, View } from 'react-native';

type TranscriptCardProps = {
  transcript: string;
};

export function TranscriptCard({ transcript }: TranscriptCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Transcript</Text>
      <Text style={styles.body}>
        {transcript || 'Transcript will appear here after Aegis Vision processes the recording.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#112235',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#32465a',
  },
});
