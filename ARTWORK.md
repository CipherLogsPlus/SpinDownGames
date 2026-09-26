# Card images and asset provenance

## Featured cards

The homepage uses real card images, arranged with CSS. Pokémon is centered, Magic: The Gathering is on the left, and Yu-Gi-Oh! is on the right. The selections use regular released cards rather than trophy cards or premium chase variants.

| Position | Game                 | Card                               | Printing                                         | Website asset                                    |
| -------- | -------------------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Left     | Magic: The Gathering | Goldspan Dragon                    | Kaldheim 139, regular mythic rare                | `assets/cards/magic-goldspan-dragon.webp`        |
| Center   | Pokémon              | Pikachu                            | Scarlet & Violet—151, 173/165, illustration rare | `assets/cards/pokemon-pikachu.webp`              |
| Right    | Yu-Gi-Oh!            | Blue-Eyes Alternative White Dragon | Movie Pack MVP1-EN046, Ultra Rare                | `assets/cards/yugioh-blue-eyes-alternative.webp` |

These are display selections, not inventory listings, price quotes, or a claim that the shop currently owns these specific cards. The visible caption identifies them as display cards. The image content, rules text, and printed credits were not generated or redrawn.

Sources retrieved September 26, 2026:

- **Pokémon:** [official card image](https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/SV3PT5/SV3PT5_EN_173.png), checked against [the official Pokémon card database](https://www.pokemon.com/de/pokemon-sammelkartenspiel/pokemon-karten/series/sv3pt5/173). The original 245 × 342 image was encoded as lossless WebP without resizing. Card illustration: Hiroyuki Yamamoto. Pokémon card artwork is credited on the card to Pokémon / Nintendo / Creatures / GAME FREAK.
- **Magic:** [Scryfall card record](https://scryfall.com/card/khm/139/goldspan-dragon), [source image](https://cards.scryfall.io/png/front/9/d/9d914868-9000-4df2-a818-0ef8a7f636ae.png). The full card was resized to 600 × 838 and encoded as WebP. Illustration: Andrew Mar. Card copyright: Wizards of the Coast.
- **Yu-Gi-Oh!:** [Konami’s official card details and printing list](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=12253&ope=2&request_locale=en), with a printed-card scan from [Total Cards](https://totalcards.net/products/yu-gi-oh-yu-gi-oh-the-dark-side-of-dimensions-movie-pack-blue-eyes-alternative-white-dragon-ultra-rare-mvp1-en046), [source image](https://totalcards.net/cdn/shop/files/6ef76b493a1825209947de5380dff84f.jpg?v=1748103398&width=535). Only the surrounding white margin was removed; the card face and printed credits remain intact. Final size: 343 × 509. Card copyright is credited on the card to Kazuki Takahashi; Yu-Gi-Oh! is a Konami property.

All three files are served locally by the website. There are no runtime card API requests, price feeds, or external image dependencies. Publisher artwork and trademarks remain the property of their respective owners; these source records do not claim ownership or a license grant.

The generated fantasy hero was removed from the current site and social preview. Its prior assets and prompt remain recoverable in Git history.

## Existing brand and coin

`assets/brand-original.jpg` was extracted unchanged from the embedded logo in GitHub revision `876c5ba`. `assets/brand.webp` is a resized 320px WebP copy. The original logo is also the social-sharing preview.

`assets/coin.glb` and `assets/coin-poster.webp` are preserved from that same revision. The custom renderer retains the supplied geometry and visual presentation.

## Fonts and interface graphics

Anton and DM Sans are self-hosted Google Fonts; their SIL Open Font Licenses are included in `assets/fonts/`. Anton was downloaded via the official Google Fonts stylesheet; DM Sans is the variable font from the official `google/fonts` repository.

The small card, orbit, lightning, and die interface graphics are CSS/SVG. The favicon is a geometric die; the supplied logo remains the primary brand image.
