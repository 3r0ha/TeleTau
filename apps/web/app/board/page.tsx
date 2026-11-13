import { BoardScreen } from "../_components/learn/BoardScreen";

// Страница ученика; Telegram Mini App реэкспортирует её под /miniapp (адреса — от префикса, learn/paths.tsx).
export default function Page() {
  return <BoardScreen />;
}
