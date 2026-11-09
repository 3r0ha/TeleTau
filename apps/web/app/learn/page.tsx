import { LearnFlow } from "../_components/learn/LearnFlow";

// Страница ученика; Telegram Mini App реэкспортирует её под /miniapp (адреса — от префикса, learn/paths.tsx).
export default function Page() {
  return <LearnFlow />;
}
