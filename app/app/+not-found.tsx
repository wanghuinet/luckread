import { Link, Stack } from 'expo-router';
import { Text } from 'react-native';

import { Container } from '~/components/Container';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '页面未找到' }} />
      <Container>
        <Text className={styles.title}>找不到此页面，链接可能已失效或页面已移动。</Text>
        <Link href="/" className={styles.link}>
          <Text className={styles.linkText}>返回首页</Text>
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
