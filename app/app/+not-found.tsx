import { Link, Stack } from 'expo-router';
import { Text } from 'react-native';

import { Container } from '~/components/Container';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <Container>
        <Text className={styles.title}>This screen doesn't exist.</Text>
        <Link href="/" className={styles.link}>
          <Text className={styles.linkText}>Go to home screen!</Text>
        </Link>
      </Container>
    </>
  );
}

const styles = {
  title: `text-xl font-bold text-neutral-900 dark:text-white`,
  link: `mt-4 pt-4`,
  linkText: `text-base text-sky-600 dark:text-sky-400`,
};
