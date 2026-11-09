// Компоненты «ТелеТау» v2 для веба и консоли (@teletau/ui). Зависят только от react, next, @phosphor-icons/react
// и дизайн-токенов. Пакет без сборки: исходники транслирует Next.js (transpilePackages); стили — ui.css
// (импортирует токены и шрифты), подключается в корневом layout приложения: `import "@teletau/ui/ui.css"`.
export { Button, ButtonLink, IconButton, LinkButton, TextLink, buttonClass, type ButtonProps, type ButtonVariant } from "./Button";
export { Card, CardSub, CardTitle } from "./Card";
export { Chip, type ChipTone } from "./Chip";
export { ChoiceGroup, type Choice } from "./ChoiceGroup";
export { CodeInput } from "./CodeInput";
export { Dialog } from "./Dialog";
export { EmptyState, Illustration } from "./EmptyState";
export { Form, useInvalidFocus, type FormProps, type InvalidFocus } from "./Form";
export { HEX_TONES, HexAvatar, toneFor, type HexTone } from "./HexAvatar";
export { LEAGUE_TIERS, avatarFor, avatars, beeFrames, illustrations, leagueBadges, type IllustrationName, type LeagueTier } from "./illustrations";
export { AVATAR_NOUNS, avatarSlugFor, type AvatarSlug } from "./avatars";
export { InlineAlert } from "./InlineAlert";
export { ProgressBar } from "./ProgressBar";
export { Skeleton, SkeletonGroup, type SkeletonRadius } from "./Skeleton";
export { StepHeading } from "./StepHeading";
export { TextArea, TextField } from "./TextField";
export { ToastProvider, useToast, type ToastTone } from "./Toast";
export { BottomNav, TopNav, type NavItem } from "./BottomNav";
export { Brand, TopBar } from "./TopBar";
export { hexPath } from "./hex";
export { openSheetEntry } from "./sheetHistory";
// Примитивы тропы, урока и мотивации (prototypes/trail-expedition).
export { AnswerOptions, type AnswerOptionItem, type AnswerOptionsProps, type OptionTone } from "./AnswerOption";
export { FeedbackSheet, type FeedbackSheetProps, type FeedbackTone } from "./FeedbackSheet";
export { HexNode, type HexNodeProps, type HexNodeState, type HexNodeTone } from "./HexNode";
export { HoneyComb, type CombCell, type HoneyCombProps } from "./HoneyComb";
export { LeagueBoard, LeagueRow, LeagueZone, type LeagueRowProps, type LeagueZoneKind } from "./LeagueRow";
export { BASHKIR_LETTERS, LetterPanel, type LetterPanelProps } from "./LetterPanel";
export { StatTile, StatTiles } from "./StatTile";
export { StudentSideNav, StudentTabBar, type StudentSection, type StudentTab } from "./StudentTabBar";
// Оболочка на компьютере и планшете (shell.css): боковая навигация и точки раскладки.
export { SHELL_RAIL_QUERY, SHELL_SIDE_QUERY, SideNav, useMediaQuery } from "./SideNav";
export { WordTile, type WordTileProps } from "./WordTile";
// Движение и картинки «живого» продукта (design/prompts/batch-3-animation.md): пчела с кадрами, конфетти, блик, счётчик.
export { Bee, SvgBee, type BeeProps, type SvgBeeProps } from "./Bee";
export { GlintBadge, type GlintBadgeProps } from "./GlintBadge";
// Повторение слов, словарь, цель дня — «Послушать» (запись носителя из контента) и сота цели дня.
export { GoalMeter, type GoalMeterProps } from "./GoalMeter";
export { SpeakButton, type AudioSource, type SpeakButtonProps } from "./SpeakButton";
export { HoneyConfetti } from "./HoneyConfetti";
export { motionEasing, motionMs, useCountUp, useReducedMotion } from "./motion";
export { THEME_COOKIE, parseTheme, type Theme } from "./theme-cookie";
export { setTheme, useTheme } from "./theme";
export { ThemeSwitch, ThemeToggleButton } from "./ThemeSwitch";
