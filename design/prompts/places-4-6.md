# Промпты: детали мест 4–6 экспедиции (вывески и декорации тропы)

Большие картинки мест уже есть (`place-yamantau-hero`, `place-village-hero`, `place-sabantuy-hero`). Здесь остальное для каждого места:
- **вывеска** — узкий баннер над юнитом на тропе;
- **4 декорации** — предметы, которые стоят вдоль тропы, как трамвай и памятник у Уфы.

**Как генерировать:**
- **к вывеске** прикрепляй `design/assets/incoming/place-ufa-sign.jpg` (референс стиля вывески);
- **к декорациям** прикрепляй `design/assets/incoming/deco-ufa-tram.jpg` (референс стиля), а если можно две картинки — ещё и большую картинку этого места (`place-yamantau-hero.jpg`, `place-village-hero.jpg` или `place-sabantuy-hero.jpg`): так предметы совпадут с местом по цветам;
- формат кадра стоит в первой фразе промпта: вывески — 21:9, декорации — 1:1;
- сохраняй под именем из заголовка в `design/assets/incoming/`.

## Гора Ямантау

### `place-yamantau-sign` — вывеска
```
Ultra-wide 21:9 horizontal banner illustration, all important content kept within the vertical middle band. The left half of the banner is a calm flat honey-yellow (#FFB703) area with only a faint thin row of Bashkir folk ornament (a chain of small rhombuses) running along its bottom edge — leave it empty for a title. The right half shows a simplified flat silhouette scene: layered rounded mountain ridges of the Southern Urals, the highest one with a small snowy top, soft mist between the ridges as flat pale stripes, a few pine trees in front. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Avoid: any text, letters or numbers, watermarks, logos, frames or borders, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, drop shadows, clutter, people, human faces.
```

### `deco-yamantau-peak` — маленькая гора со снежной шапкой
```
Square 1:1 image of a single isolated object: a small rounded mountain peak with a white snowy cap and two pale mist stripes at its foot, like a toy mountain. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-yamantau-spruce` — три ели
```
Square 1:1 image of a single isolated object: a cluster of three cute rounded spruce trees of different heights standing close together, only the trees. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-yamantau-waterfall` — водопад на камнях
```
Square 1:1 image of a single isolated object: a tiny waterfall falling over three rounded stones into a small round pool, simple flat water stripes. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-yamantau-elk` — лосёнок
```
Square 1:1 image of a single isolated object: a cute young elk calf standing in side view with tiny rounded antler buds, friendly face, big eyes. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces, adult antlers.
```

## Башкирская деревня

### `place-village-sign` — вывеска
```
Ultra-wide 21:9 horizontal banner illustration, all important content kept within the vertical middle band. The left half of the banner is a calm flat honey-yellow (#FFB703) area with only a faint thin row of Bashkir folk ornament (a chain of small rhombuses) running along its bottom edge — leave it empty for a title. The right half shows a simplified flat silhouette scene: a wooden village house with carved window frames, a row of small wooden beehives beside it and a rounded linden tree. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Avoid: any text, letters or numbers, watermarks, logos, frames or borders, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, drop shadows, clutter, people, human faces.
```

### `deco-village-house` — дом с резными наличниками
```
Square 1:1 image of a single isolated object: a small cozy wooden log house in front view with carved honey-yellow window frames, a coral-red roof and a little chimney. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-village-hives` — пасека — ряд ульев
```
Square 1:1 image of a single isolated object: a row of three small wooden beehives with slanted roofs, painted honey, cream and coral, two tiny bees flying above them. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-village-well` — деревянный колодец
```
Square 1:1 image of a single isolated object: a small wooden village well with a little roof, a crank handle and a bucket hanging on a rope. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-village-geese` — гуси
```
Square 1:1 image of a single isolated object: two cute white domestic geese walking one after another in side view, orange beaks and feet. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

## Сабантуй

### `place-sabantuy-sign` — вывеска
```
Ultra-wide 21:9 horizontal banner illustration, all important content kept within the vertical middle band. The left half of the banner is a calm flat honey-yellow (#FFB703) area with only a faint thin row of Bashkir folk ornament (a chain of small rhombuses) running along its bottom edge — leave it empty for a title. The right half shows a simplified flat silhouette scene: a festive meadow with colorful flag garlands, a tall climbing pole with a small prize on top and the roof of a festival tent. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Avoid: any text, letters or numbers, watermarks, logos, frames or borders, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, drop shadows, clutter, people, human faces.
```

### `deco-sabantuy-pole` — столб с призом
```
Square 1:1 image of a single isolated object: a tall smooth wooden climbing pole with a small round wooden wheel on top holding a tiny prize basket and two fluttering ribbons. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-sabantuy-horse` — скакун в нарядной попоне
```
Square 1:1 image of a single isolated object: a cute racing horse in side view, mid-gallop, with a colorful saddle cloth decorated with a rhombus ornament and ribbons in its mane, no rider. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces, riders, saddles with people.
```

### `deco-sabantuy-swing` — качели
```
Square 1:1 image of a single isolated object: a traditional wooden festival swing: two tall wooden posts with a crossbar and a hanging wooden seat on ropes, decorated with small flags. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

### `deco-sabantuy-flags` — гирлянда флажков
```
Square 1:1 image of a single isolated object: a curved garland of small triangular flags in honey yellow, coral red, violet and green hanging on a string. If a reference illustration is attached, match its illustration style exactly but do not copy its subject. Style: flat vector illustration for a children's language-learning app, clean geometric shapes with softly rounded corners, flat color fills with at most one subtle shading tone per shape, no outlines, soft light from the top left. Use only this palette: honey yellow #FFB703, deep honey #E39400, cream #FFF8EC, forest green #2C9C45, fresh green #43C35E, river blue #1CA7F2, coral red #FF5A5A, violet #9B5CFF, dark chocolate brown #3B2716, silver gray #9AA6B2. Isolated on a plain pure white background, object centered with generous empty margins so it can be cut out cleanly. Avoid: any text, letters, numbers or signs, watermarks, logos, frames, landscape, ground, cast shadows, photorealism, 3D rendering, glossy look, color gradients, noise texture, outlines, people, human faces.
```

