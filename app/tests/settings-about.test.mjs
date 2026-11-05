import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../app/(drawer)/settings.tsx', import.meta.url), 'utf8');
const about = readFileSync(new URL('../app/(drawer)/about.tsx', import.meta.url), 'utf8');
const registration = readFileSync(new URL('../app/register.tsx', import.meta.url), 'utf8');
const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));

test('Help and About is reachable from Settings and remains hidden from the drawer item list', () => {
  expect(settings).toContain('title="帮助与关于"');
  expect(settings).toContain("router.push('/about' as never)");
  expect(drawer).toContain('<Drawer.Screen name="about"');
  expect(drawer).toContain('name="about" options={{ headerShown: false, drawerItemStyle: { display: \'none\' } }}');
});

test('About page reuses the exact Terms and Privacy URLs already used at registration', () => {
  expect(about).toContain("const TERMS_URL = 'https://luckread.com/terms'");
  expect(about).toContain("const PRIVACY_URL = 'https://luckread.com/privacy'");
  expect(registration).toContain("openPolicy('https://luckread.com/terms')");
  expect(registration).toContain("openPolicy('https://luckread.com/privacy')");
  expect(about).toContain('Linking.openURL(url)');
  expect(about).toContain('暂时无法打开用户协议');
  expect(about).toContain('暂时无法打开隐私政策');
});

test('About page explains unavailable support capabilities rather than showing dead or invented contact buttons', () => {
  expect(about).toContain('帮助中心、在线客服和工单系统尚未接入 APP 1.0');
  expect(about).not.toContain('mailto:');
  expect(about).not.toContain('support@luckread.com');
  expect(about).not.toContain('router.push(\'/help');
});

test('About page reads app version and platform build information from native configuration', () => {
  expect(about).toContain("Constants.expoConfig?.version?.trim()");
  expect(about).toContain('Constants.platform?.android?.versionCode');
  expect(about).toContain('Constants.platform?.ios?.buildNumber');
  expect(about).toContain('当前运行环境未提供');
  expect(appConfig.expo.version).toBeTruthy();
});

test('About page preserves accessibility and app theme support', () => {
  expect(about).toContain('accessibilityRole="button"');
  expect(about).toContain('accessibilityHint={description +');
  expect(about).toContain('dark:bg-black');
  expect(about).toContain('accessibilityLiveRegion="assertive"');
});
