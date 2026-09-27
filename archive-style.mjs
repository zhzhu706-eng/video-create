import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const ARCHIVE_STYLE = '复古档案拼贴动画';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ease = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const lines = (text, limit = 13, max = 3) => {
  const chars = [...String(text).replace(/\s+/g, ' ').trim()];
  return Array.from({length: max}, (_, i) => chars.slice(i * limit, (i + 1) * limit).join('')).filter(Boolean);
};

// An authored collage: paper panels, numbered evidence, a drawn trajectory and a moving marker.
// Rendering at 8 fps gives the slightly stepped motion of cut-paper animation.
export async function renderArchiveFrames({dir, scene, title, imagePath, width, height, duration, count}) {
  await fs.mkdir(dir, {recursive:true});
  const frames = Math.max(8, Math.ceil(duration * 8));
  let photo = '';
  if (imagePath && await fs.access(imagePath).then(() => true).catch(() => false)) {
    const data = await sharp(imagePath).resize(850, 800, {fit:'cover'}).jpeg({quality:72}).toBuffer();
    photo = `data:image/jpeg;base64,${data.toString('base64')}`;
  }
  const mark = String(scene.index + 1).padStart(2, '0');
  const headline = lines(title || '观察档案', 10, 2);
  const phrase = lines(scene.caption, 13, 3);
  const cardText = phrase.map((line, i) => `<text x="92" y="${770 + i * 53}" font-size="39" font-weight="700" fill="#261f1a">${esc(line)}</text>`).join('');
  const titleText = headline.map((line, i) => `<text x="74" y="${142 + i * 67}" font-size="55" font-weight="900" fill="#241b17">${esc(line)}</text>`).join('');
  const bg = `<defs><pattern id="grain" width="37" height="37" patternUnits="userSpaceOnUse"><circle cx="3" cy="8" r="1" fill="#5c4738" opacity=".16"/><circle cx="25" cy="29" r=".8" fill="#3c2921" opacity=".12"/><path d="M8 32l3 -1" stroke="#3c2921" opacity=".1"/></pattern><filter id="shadow"><feDropShadow dx="8" dy="13" stdDeviation="8" flood-color="#150e0a" flood-opacity=".48"/></filter></defs><rect width="720" height="1280" fill="#241e1b"/><rect width="720" height="1280" fill="url(#grain)" opacity=".8"/><path d="M0 248H720M0 998H720" stroke="#74695d" stroke-width="2" opacity=".3"/>`;
  const photoPanel = photo ? `<image x="77" y="302" width="566" height="384" href="${photo}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="77" y="302" width="566" height="384" fill="#716454"/><circle cx="337" cy="484" r="134" fill="none" stroke="#c6b69c" stroke-width="4" opacity=".7"/><path d="M200 470Q355 351 510 498M223 537Q359 452 498 560" fill="none" stroke="#c6b69c" stroke-width="3" opacity=".65"/><text x="118" y="355" font-size="22" fill="#e9deca">FIELD RECORD / ${mark}</text>`;
  for (let i = 0; i < frames; i++) {
    const p = i / Math.max(1, frames - 1);
    const reveal = ease((p - .13) / .55);
    const panel = ease((p - .02) / .22);
    const card = ease((p - .38) / .23);
    const rx = 178 + 365 * reveal;
    const ry = 650 - 104 * Math.sin(reveal * Math.PI);
    const vertical = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 720 1280" preserveAspectRatio="xMidYMid slice" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif">${bg}
      <g transform="translate(${Math.round((1-panel)*-105)},0)" opacity="${panel}"><path d="M42 60L657 48L676 246L58 270Z" fill="#e9ddc6" filter="url(#shadow)"/><path d="M42 60L657 48L676 246L58 270Z" fill="url(#grain)"/>${titleText}<text x="76" y="231" font-size="18" letter-spacing="5" fill="#994733">ARCHIVE · STORY ${mark}</text></g>
      <g transform="translate(0,${Math.round((1-panel)*80)})" opacity="${panel}"><path d="M53 289L665 279L669 706L61 720Z" fill="#dfd2b8" filter="url(#shadow)"/>${photoPanel}<path d="M77 302L643 302L643 686L77 686Z" fill="url(#grain)" opacity=".34"/></g>
      <g opacity="${panel}"><path d="M545 310L641 303L649 394L551 399Z" fill="#d8b99b"/><text x="562" y="374" font-size="68" font-weight="900" fill="#ac422e">${mark}</text><path d="M115 641L581 641" stroke="#f0e6d0" stroke-width="2" stroke-dasharray="7 7"/></g>
      <path d="M143 650 C240 609 309 713 393 586 S515 581 559 509" fill="none" stroke="#e22f24" stroke-width="11" stroke-linecap="round" stroke-dasharray="800" stroke-dashoffset="${Math.round(800*(1-reveal))}" filter="url(#shadow)"/><circle cx="${rx}" cy="${ry}" r="${9+4*reveal}" fill="#ff4b37" opacity="${reveal}"/><circle cx="${rx}" cy="${ry}" r="${22+7*reveal}" fill="none" stroke="#ff4b37" stroke-width="3" opacity="${.7*reveal}"/>
      <g opacity="${card}" transform="translate(0,${Math.round((1-card)*80)})"><path d="M53 731L672 712L664 974L47 996Z" fill="#e9dcc3" filter="url(#shadow)"/><path d="M53 731L672 712L664 974L47 996Z" fill="url(#grain)"/><rect x="72" y="745" width="91" height="9" fill="#ac422e"/>${cardText}</g>
      <g opacity="${ease((p-.6)/.18)}"><path d="M64 1056L655 1028" stroke="#b6a58b" stroke-width="2"/><text x="65" y="1100" fill="#d8c8ad" font-size="24" letter-spacing="4">CASE ${mark}  /  ${count}  ·  DOCUMENTARY CUT</text><rect x="63" y="1135" width="108" height="13" fill="#bb4934"/><text x="65" y="1204" fill="#f5e9cf" font-size="29" font-weight="800">观察 · 线索 · 推进</text></g>
    </svg>`;
    const horizontalTitle = lines(title || '观察档案',8,2).map((line,j)=>`<text x="70" y="${142+j*66}" font-size="54" font-weight="900" fill="#241b17">${esc(line)}</text>`).join('');
    const horizontalCaption = lines(scene.caption,10,3).map((line,j)=>`<text x="82" y="${371+j*53}" font-size="34" font-weight="800" fill="#2c211c">${esc(line)}</text>`).join('');
    const horizontalPhoto = photo ? `<image x="570" y="83" width="650" height="509" href="${photo}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="570" y="83" width="650" height="509" fill="#61554a"/><path d="M586 168L837 116L851 276L594 284Z" fill="#c7b698" transform="rotate(-3 714 200)"/><text x="614" y="189" font-size="24" font-weight="900" fill="#a04e36">01</text><path d="M604 211H807M604 233H774M604 254H821" stroke="#756456" stroke-width="3"/><path d="M969 119L1185 138L1173 292L958 279Z" fill="#d8c9ad" transform="rotate(3 1070 200)"/><text x="986" y="179" font-size="25" font-weight="900" fill="#a04e36">02</text><path d="M988 205H1147M988 228H1130M988 250H1160" stroke="#756456" stroke-width="3"/><circle cx="897" cy="408" r="152" fill="#3b3732" stroke="#d1c1a5" stroke-width="3"/><ellipse cx="897" cy="408" rx="63" ry="152" fill="none" stroke="#a9977d" stroke-width="2"/><path d="M747 408H1048M774 332H1020M774 484H1020" stroke="#a9977d" stroke-width="2"/><path d="M772 385L825 348L863 373L906 349L939 382L965 395L926 419L892 470L844 456L807 418Z" fill="#b9aa90" opacity=".8"/><path d="M647 491L718 430L736 446L710 508L688 488Z" fill="#d9c9ac" stroke="#3c3029" stroke-width="3"/><path d="M688 488L661 532L710 508" fill="#aa533e"/><path d="M1065 483L1139 435L1154 453L1126 512L1106 490Z" fill="#d9c9ac" stroke="#3c3029" stroke-width="3"/><path d="M1106 490L1080 536L1126 512" fill="#aa533e"/><path d="M594 555H1194" stroke="#d5c4a5" stroke-width="2" stroke-dasharray="7 8"/>`;
    const horizontal = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 1280 720" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif"><defs><pattern id="grain" width="37" height="37" patternUnits="userSpaceOnUse"><circle cx="3" cy="8" r="1" fill="#5c4738" opacity=".16"/><circle cx="25" cy="29" r=".8" fill="#3c2921" opacity=".12"/></pattern><filter id="shadow"><feDropShadow dx="8" dy="11" stdDeviation="7" flood-color="#150e0a" flood-opacity=".5"/></filter></defs><rect width="1280" height="720" fill="#241e1b"/><rect width="1280" height="720" fill="url(#grain)"/><g opacity="${panel}" transform="translate(${Math.round((1-panel)*-90)},0)"><path d="M47 61L527 51L537 268L55 280Z" fill="#e9ddc6" filter="url(#shadow)"/>${horizontalTitle}<text x="73" y="244" font-size="18" letter-spacing="4" fill="#a44b35">ARCHIVE · STORY ${mark}</text></g><g opacity="${panel}" transform="translate(0,${Math.round((1-panel)*50)})"><path d="M546 61L1246 58L1243 611L548 617Z" fill="#e9ddc6" filter="url(#shadow)"/>${horizontalPhoto}<rect x="570" y="83" width="650" height="509" fill="url(#grain)" opacity=".25"/><path d="M1110 98L1212 90L1217 191L1118 198Z" fill="#e6c6a8"/><text x="1124" y="171" font-size="78" font-weight="900" fill="#a44b35">${mark}</text></g><g opacity="${card}" transform="translate(0,${Math.round((1-card)*60)})"><path d="M49 308L529 299L537 536L50 551Z" fill="#e9ddc6" filter="url(#shadow)"/><rect x="71" y="326" width="114" height="10" fill="#ac422e"/>${horizontalCaption}</g><path d="M350 604 C510 526 630 609 754 489 S985 494 1110 338" fill="none" stroke="#e72e22" stroke-width="11" stroke-linecap="round" stroke-dasharray="1100" stroke-dashoffset="${Math.round(1100*(1-reveal))}" filter="url(#shadow)"/><circle cx="${350+760*reveal}" cy="${604-220*reveal}" r="13" fill="#ff4934" opacity="${reveal}"/><g opacity="${ease((p-.6)/.18)}"><text x="62" y="668" font-size="24" fill="#e5d6bd" letter-spacing="4">CASE ${mark} / ${count} · DOCUMENTARY CUT</text><rect x="1011" y="647" width="188" height="12" fill="#be4933"/></g></svg>`;
    const frame = width > height ? horizontal : vertical;
    await sharp(Buffer.from(frame)).png({compressionLevel:5}).toFile(path.join(dir, `frame-${String(i).padStart(4,'0')}.png`));
  }
  return frames;
}
