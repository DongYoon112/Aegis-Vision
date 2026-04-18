import { StyleSheet, Text, View } from 'react-native';

type JsonCardProps = {
  json: string;
};

export function JsonCard({ json }: JsonCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Structured JSON</Text>
      <View style={styles.codeBlock}>
        <Text style={styles.code}>
          {json || '{\n  "responsive": null,\n  "severe_bleeding": null,\n  "breathing": null,\n  "notes": [],\n  "next_step": ""\n}'}
        </Text>
      </View>
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
  codeBlock: {
    borderRadius: 12,
    backgroundColor: '#0f1c2a',
    padding: 12,
  },
  code: {
    color: '#e8f0ff',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
});
