import { StyleSheet, Text, View } from 'react-native';

import type { SessionState } from '../types/session';

const LABELS: Record<SessionState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Error',
};

const COLORS: Record<SessionState, string> = {
  idle: '#d7e4ff',
  listening: '#d8f5dc',
  transcribing: '#fff2c7',
  thinking: '#ffe0c7',
  speaking: '#e1d8ff',
  error: '#ffd6d6',
};

type StatusBadgeProps = {
  state: SessionState;
};

export function StatusBadge({ state }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: COLORS[state] }]}>
      <Text style={styles.label}>{LABELS[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  label: {
    color: '#18304a',
    fontSize: 14,
    fontWeight: '700',
  },
});
