import { StyleSheet, Text, View } from 'react-native';

type ErrorCardProps = {
  error: string;
};

export function ErrorCard({ error }: ErrorCardProps) {
  if (!error) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Error</Text>
      <Text style={styles.body}>{error}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff0f0',
    borderColor: '#f3c1c1',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8b1f1f',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: '#7a2a2a',
  },
});
