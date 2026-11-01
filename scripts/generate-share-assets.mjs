import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

// Static, code-drawn branding. No remote fonts, runtime image service or market-data dependency.
const logo = await readFile(new URL('../public/flowlens.svg', import.meta.url))
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#0c0c0c"/>
<rect x="28" y="28" width="1144" height="574" rx="16" fill="#111111" stroke="#2a2a2a"/>
<path d="M760 120V490M850 120V490M940 120V490M1030 120V490M710 185H1100M710 275H1100M710 365H1100M710 455H1100" stroke="#242424" stroke-width="1"/>
<g opacity=".75" stroke-width="3">
<path d="M748 361V453M798 313V398M848 336V425M898 235V369M948 200V291M998 220V312M1048 150V265M1098 127V219" stroke="#666"/>
<path d="M748 405V429M798 340V381M898 270V340M948 224V267M1048 177V240M1098 155V198" stroke="#16c784" stroke-width="19"/>
<path d="M848 359V399M998 246V288" stroke="#ea3943" stroke-width="19"/>
</g>
<path d="M713 443L764 412L815 374L865 389L914 319L965 269L1016 280L1066 223L1117 184" fill="none" stroke="#f0b90b" stroke-width="2" opacity=".5"/>
<rect x="72" y="75" width="76" height="76" rx="14" fill="#171717" stroke="#363636"/>
<path d="M93 128V97H127M93 112H116" fill="none" stroke="#f0b90b" stroke-width="6"/>
<path d="M115 121V129H128" fill="none" stroke="#f5f5f5" stroke-width="6"/>
<text x="169" y="125" fill="#f5f5f5" font-size="48" font-weight="700" font-family="DejaVu Sans, sans-serif">FlowLens</text>
<text x="74" y="220" fill="#f0b90b" font-size="17" letter-spacing="3" font-family="DejaVu Sans, sans-serif">CRYPTO MARKET ANALYSIS</text>
<text x="70" y="304" fill="#f5f5f5" font-size="66" font-weight="700" font-family="DejaVu Sans, sans-serif">Read the market.</text>
<text x="74" y="356" fill="#a3a3a3" font-size="23" font-family="DejaVu Sans, sans-serif">Liquidity, executions and market context.</text>
<g fill="#191919" stroke="#333"><rect x="74" y="403" width="135" height="44" rx="6"/><rect x="221" y="403" width="140" height="44" rx="6"/><rect x="373" y="403" width="155" height="44" rx="6"/></g>
<g fill="#d4d4d4" font-size="17" font-family="DejaVu Sans, sans-serif" text-anchor="middle"><text x="141" y="431">Heatmap</text><text x="291" y="431">Footprint</text><text x="450" y="431">Whale flow</text></g>
<path d="M74 514H1126" stroke="#2a2a2a"/>
<text x="74" y="559" fill="#a3a3a3" font-size="18" font-family="DejaVu Sans, sans-serif">By Abid Habib</text>
<text x="1126" y="559" fill="#f0b90b" font-size="18" font-family="DejaVu Sans, sans-serif" text-anchor="end">crypto.abidhabib.pro</text>
</svg>`
await sharp(Buffer.from(svg)).png().toFile(new URL('../public/flowlens-share-v1.png', import.meta.url).pathname)
await sharp(logo).resize(192, 192).png().toFile(new URL('../public/flowlens-icon.png', import.meta.url).pathname)
await sharp(logo).resize(180, 180).png().toFile(new URL('../public/flowlens-apple-icon.png', import.meta.url).pathname)
console.log('Created FlowLens share image (1200×630), PNG icon and Apple touch icon.')
