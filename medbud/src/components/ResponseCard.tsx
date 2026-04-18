import { StyleSheet, Text, View } from 'react-native';

type ResponseCardProps = {
  response: string;
};

export function ResponseCard({ response }: ResponseCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Stitch Response</Text>
      <Text style={styles.body}>
        {response || 'A short spoken emergency guidance line will appear here.'}
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
