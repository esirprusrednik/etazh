// Компактная изометрическая сцена офиса для плашки на главном экране.
// Цвет здания — по офису, окна гаснут вечером, человечки у входа = банда здесь (до трёх).
const OFFICE_COLORS = {
  smol: ['#FF8A8A', '#E5484D', '#B8333A'],
  mark: ['#86BEFF', '#3A86FF', '#2563C9'],
  vor: ['#FFD978', '#F4A72C', '#C9821B']
};
const DEFAULT_COLORS = ['#B9C3DA', '#6F7FA8', '#4A5A82'];

const LEFT = [[44, 38], [44, 49], [44, 60], [44, 71], [53, 42.5], [53, 53.5], [53, 64.5], [53, 75.5], [62, 47], [62, 58], [62, 69]];
const RIGHT = [[74, 49], [74, 60], [74, 71], [74, 82], [83, 44.5], [83, 55.5], [83, 66.5], [83, 77.5], [92, 40], [92, 51], [92, 62], [92, 73]];
const PEOPLE = [[80, 104, '#E5484D', '#F6D3B3'], [91, 99, '#2563C9', '#E8B48A'], [102, 106, '#1F7A3A', '#C98E62']];

export function officeSvg({ office, crowd = 0, hour = 12, label = '' }) {
  const night = hour >= 19 || hour < 7;
  const evening = hour >= 17 && hour < 19;
  const sky = night ? '#2B3A6B' : evening ? '#F7B58A' : '#A7E0FF';
  const [top, left, right] = OFFICE_COLORS[office] || DEFAULT_COLORS;
  const litShare = night ? 0.15 : evening ? 0.55 : 0.8;
  const lit = (i) => ((i * 7 + 3) % 11) / 11 < litShare;
  const winL = LEFT.map(([x, y], i) => `<polygon points="${x},${y} ${x + 6},${y + 3} ${x + 6},${y + 10} ${x},${y + 7}" fill="${lit(i) ? '#FFF3B0' : '#4B5A7A'}"/>`).join('');
  const winR = RIGHT.map(([x, y], i) => `<polygon points="${x},${y} ${x + 6},${y - 3} ${x + 6},${y + 4} ${x},${y + 7}" fill="${lit(i + 4) ? '#FFE38A' : '#3F4D6B'}"/>`).join('');
  const people = night ? '' : PEOPLE.slice(0, Math.min(3, crowd)).map(([x, y, body, skin]) =>
    `<rect x="${x}" y="${y}" width="5" height="9" rx="2.5" fill="${body}"/><circle cx="${x + 2.5}" cy="${y - 3}" r="3" fill="${skin}"/>`).join('');
  const sun = night
    ? '<circle cx="122" cy="16" r="7" fill="#F4F1DE"/><circle cx="20" cy="14" r="1.2" fill="#fff"/><circle cx="36" cy="26" r="1" fill="#fff"/><circle cx="108" cy="34" r="1" fill="#fff"/>'
    : '<circle cx="122" cy="16" r="9" fill="#FFE38A"/><ellipse cx="22" cy="22" rx="12" ry="4.5" fill="#fff" opacity=".9"/><ellipse cx="30" cy="19" rx="7" ry="4" fill="#fff" opacity=".9"/>';
  return `<svg viewBox="0 0 140 134" width="124" height="119" role="img" aria-label="${label}" style="display:block">
  <rect x="0" y="0" width="140" height="134" fill="${sky}"/>${sun}
  <polygon points="10,92 70,122 70,129 10,99" fill="#5A3E2B"/><polygon points="130,92 70,122 70,129 130,99" fill="#47301F"/>
  <polygon points="70,62 130,92 70,122 10,92" fill="${night ? '#4E8F3A' : '#7ED957'}"/><polygon points="58,99 64,102 46,111 40,108" fill="#F3E2B8"/>
  <polygon points="40,29 70,44 70,98 40,83" fill="${left}"/><polygon points="100,29 70,44 70,98 100,83" fill="${right}"/><polygon points="70,14 100,29 70,44 40,29" fill="${top}"/>
  <polygon points="74,22 82,26 82,30 74,26" fill="#C9CED9"/><polygon points="90,22 82,26 82,30 90,26" fill="#A9B0C0"/><polygon points="82,18 90,22 82,26 74,22" fill="#E6E9F0"/>
  <rect x="57" y="8" width="1.6" height="14" fill="#1A2547"/><circle cx="57.8" cy="7.5" r="2" fill="#FFC93C"/>
  ${winL}<polygon points="61,84.5 67,87.5 67,96.5 61,93.5" fill="#5A2A1E"/>${winR}
  <rect x="21" y="86" width="3" height="8" fill="#7A4E2D"/><circle cx="22.5" cy="82" r="7" fill="#2FA84F"/><circle cx="20" cy="80" r="3" fill="#5BD27A"/>
  <rect x="115" y="90" width="3" height="8" fill="#7A4E2D"/><circle cx="116.5" cy="86" r="7" fill="#2FA84F"/><circle cx="114" cy="84" r="3" fill="#5BD27A"/>
  ${people}
</svg>`;
}
