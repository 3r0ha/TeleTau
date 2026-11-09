import { ProfileScreen } from "../_components/learn/ProfileScreen";

// Страница ученика; Telegram Mini App реэкспортирует её под /miniapp (адреса — от префикса, learn/paths.tsx).
export default function Page() {
  return <ProfileScreen />;
}
