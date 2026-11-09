import { WordsScreen } from "../../_components/learn/WordsScreen";

// «Мой словарь» ученика; Telegram Mini App реэкспортирует страницу под /miniapp (адреса — от префикса, learn/paths.tsx).
export default function Page() {
  return <WordsScreen />;
}
