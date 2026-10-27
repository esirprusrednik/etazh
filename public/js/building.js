// Изометрическое здание офиса (сгенерировано из прототипа). Окна горят «по-настроению», человечки = банда здесь.
const OFFICE_COLORS = { smol: ['#FF8A8A', '#E5484D', '#B8333A'], mark: ['#86BEFF', '#3A86FF', '#2563C9'], vor: ['#FFD978', '#F4A72C', '#C9821B'] };
const DEFAULT_COLORS = ['#B9C3DA', '#6F7FA8', '#4A5A82'];

export function buildingSvg({ office, crowd = 0, hour = 12, label = '' }) {
  const night = hour >= 19 || hour < 7;
  const evening = hour >= 17 && hour < 19;
  const sky = night ? '#2B3A6B' : evening ? '#F7B58A' : '#A7E0FF';
  const c = OFFICE_COLORS[office] || DEFAULT_COLORS;
  const N = 40;
  const lit = night ? 4 : evening ? 18 : 30;
  const W = [];
  for (let i = 0; i < N; i++) {
    const rank = (i * 7 + 3) % N;
    const left = i < N / 2;
    W.push(rank < lit ? (left ? '#FFF3B0' : '#FFE38A') : (left ? '#4B5A7A' : '#3F4D6B'));
  }
  const P = [];
  for (let i = 0; i < 8; i++) P.push(i < Math.min(8, night ? 0 : crowd) ? 'inline' : 'none');
  return `<svg width="100%" viewBox="0 0 390 270" role="img" aria-label="${label}">
            <rect x="0" y="0" width="390" height="270" fill="${sky}"></rect>
            <g style="display: ${night?"inline":"none"}"><circle cx="40" cy="30" r="1.6" fill="#FFFFFF"></circle><circle cx="120" cy="18" r="1.2" fill="#FFFFFF"></circle><circle cx="330" cy="28" r="1.6" fill="#FFFFFF"></circle><circle cx="365" cy="90" r="1.2" fill="#FFFFFF"></circle><circle cx="25" cy="100" r="1.2" fill="#FFFFFF"></circle></g>
            <g opacity="${night?0.15:0.9}"><ellipse cx="62" cy="44" rx="30" ry="11" fill="#FFFFFF"></ellipse><ellipse cx="84" cy="38" rx="18" ry="10" fill="#FFFFFF"></ellipse><ellipse cx="330" cy="62" rx="28" ry="10" fill="#FFFFFF"></ellipse></g>
<polygon points="45.0,175.0 195.0,250.0 195.0,266.0 45.0,191.0" fill="#5A3E2B"></polygon><polygon points="345.0,175.0 195.0,250.0 195.0,266.0 345.0,191.0" fill="#47301F"></polygon><polygon points="195.0,100.0 345.0,175.0 195.0,250.0 45.0,175.0" fill="#7ED957"></polygon>
<polygon points="45.0,175.0 195.0,250.0 195.0,255.0 45.0,180.0" fill="#5BB83C"></polygon>
<polygon points="345.0,175.0 195.0,250.0 195.0,255.0 345.0,180.0" fill="#4A9E30"></polygon>
<polygon points="148.0,191.5 162.0,198.5 127.0,216.0 113.0,209.0" fill="#F3E2B8"></polygon>
<rect x="184.5" y="102.0" width="5" height="14" fill="#7A4E2D"></rect><circle cx="187.0" cy="95.0" r="12" fill="#2FA84F"></circle><circle cx="183.0" cy="91.0" r="5" fill="#5BD27A"></circle>
<rect x="77.5" y="163.5" width="5" height="14" fill="#7A4E2D"></rect><circle cx="80.0" cy="156.5" r="12" fill="#2FA84F"></circle><circle cx="76.0" cy="152.5" r="5" fill="#5BD27A"></circle>
<polygon points="195.0,127.0 291.0,175.0 195.0,223.0 99.0,175.0" fill="#FFE45E" opacity="0.55"></polygon>
<polygon points="115.0,57.0 195.0,97.0 195.0,215.0 115.0,175.0" fill="${c[1]}"></polygon><polygon points="275.0,57.0 195.0,97.0 195.0,215.0 275.0,175.0" fill="${c[2]}"></polygon><polygon points="195.0,17.0 275.0,57.0 195.0,97.0 115.0,57.0" fill="${c[0]}"></polygon>
<polygon points="121.0,162.0 129.0,166.0 129.0,156.0 121.0,152.0" fill="${W[0]}"></polygon>
<polygon points="121.0,144.0 129.0,148.0 129.0,138.0 121.0,134.0" fill="${W[1]}"></polygon>
<polygon points="121.0,126.0 129.0,130.0 129.0,120.0 121.0,116.0" fill="${W[2]}"></polygon>
<polygon points="121.0,108.0 129.0,112.0 129.0,102.0 121.0,98.0" fill="${W[3]}"></polygon>
<polygon points="121.0,90.0 129.0,94.0 129.0,84.0 121.0,80.0" fill="${W[4]}"></polygon>
<polygon points="141.0,172.0 149.0,176.0 149.0,166.0 141.0,162.0" fill="${W[5]}"></polygon>
<polygon points="141.0,154.0 149.0,158.0 149.0,148.0 141.0,144.0" fill="${W[6]}"></polygon>
<polygon points="141.0,136.0 149.0,140.0 149.0,130.0 141.0,126.0" fill="${W[7]}"></polygon>
<polygon points="141.0,118.0 149.0,122.0 149.0,112.0 141.0,108.0" fill="${W[8]}"></polygon>
<polygon points="141.0,100.0 149.0,104.0 149.0,94.0 141.0,90.0" fill="${W[9]}"></polygon>
<polygon points="161.0,182.0 169.0,186.0 169.0,176.0 161.0,172.0" fill="${W[10]}"></polygon>
<polygon points="161.0,164.0 169.0,168.0 169.0,158.0 161.0,154.0" fill="${W[11]}"></polygon>
<polygon points="161.0,146.0 169.0,150.0 169.0,140.0 161.0,136.0" fill="${W[12]}"></polygon>
<polygon points="161.0,128.0 169.0,132.0 169.0,122.0 161.0,118.0" fill="${W[13]}"></polygon>
<polygon points="161.0,110.0 169.0,114.0 169.0,104.0 161.0,100.0" fill="${W[14]}"></polygon>
<polygon points="181.0,192.0 189.0,196.0 189.0,186.0 181.0,182.0" fill="${W[15]}"></polygon>
<polygon points="181.0,174.0 189.0,178.0 189.0,168.0 181.0,164.0" fill="${W[16]}"></polygon>
<polygon points="181.0,156.0 189.0,160.0 189.0,150.0 181.0,146.0" fill="${W[17]}"></polygon>
<polygon points="181.0,138.0 189.0,142.0 189.0,132.0 181.0,128.0" fill="${W[18]}"></polygon>
<polygon points="181.0,120.0 189.0,124.0 189.0,114.0 181.0,110.0" fill="${W[19]}"></polygon>
<polygon points="269.0,162.0 261.0,166.0 261.0,156.0 269.0,152.0" fill="${W[20]}"></polygon>
<polygon points="269.0,144.0 261.0,148.0 261.0,138.0 269.0,134.0" fill="${W[21]}"></polygon>
<polygon points="269.0,126.0 261.0,130.0 261.0,120.0 269.0,116.0" fill="${W[22]}"></polygon>
<polygon points="269.0,108.0 261.0,112.0 261.0,102.0 269.0,98.0" fill="${W[23]}"></polygon>
<polygon points="269.0,90.0 261.0,94.0 261.0,84.0 269.0,80.0" fill="${W[24]}"></polygon>
<polygon points="249.0,172.0 241.0,176.0 241.0,166.0 249.0,162.0" fill="${W[25]}"></polygon>
<polygon points="249.0,154.0 241.0,158.0 241.0,148.0 249.0,144.0" fill="${W[26]}"></polygon>
<polygon points="249.0,136.0 241.0,140.0 241.0,130.0 249.0,126.0" fill="${W[27]}"></polygon>
<polygon points="249.0,118.0 241.0,122.0 241.0,112.0 249.0,108.0" fill="${W[28]}"></polygon>
<polygon points="249.0,100.0 241.0,104.0 241.0,94.0 249.0,90.0" fill="${W[29]}"></polygon>
<polygon points="229.0,182.0 221.0,186.0 221.0,176.0 229.0,172.0" fill="${W[30]}"></polygon>
<polygon points="229.0,164.0 221.0,168.0 221.0,158.0 229.0,154.0" fill="${W[31]}"></polygon>
<polygon points="229.0,146.0 221.0,150.0 221.0,140.0 229.0,136.0" fill="${W[32]}"></polygon>
<polygon points="229.0,128.0 221.0,132.0 221.0,122.0 229.0,118.0" fill="${W[33]}"></polygon>
<polygon points="229.0,110.0 221.0,114.0 221.0,104.0 229.0,100.0" fill="${W[34]}"></polygon>
<polygon points="209.0,192.0 201.0,196.0 201.0,186.0 209.0,182.0" fill="${W[35]}"></polygon>
<polygon points="209.0,174.0 201.0,178.0 201.0,168.0 209.0,164.0" fill="${W[36]}"></polygon>
<polygon points="209.0,156.0 201.0,160.0 201.0,150.0 209.0,146.0" fill="${W[37]}"></polygon>
<polygon points="209.0,138.0 201.0,142.0 201.0,132.0 209.0,128.0" fill="${W[38]}"></polygon>
<polygon points="209.0,120.0 201.0,124.0 201.0,114.0 209.0,110.0" fill="${W[39]}"></polygon>
<polygon points="147.0,191.0 163.0,199.0 163.0,179.0 147.0,171.0" fill="#3B2F4A"></polygon>
<polygon points="177.0,30.0 199.0,41.0 199.0,51.0 177.0,40.0" fill="#C3CCD8"></polygon><polygon points="217.0,32.0 199.0,41.0 199.0,51.0 217.0,42.0" fill="#A3AEBD"></polygon><polygon points="195.0,21.0 217.0,32.0 199.0,41.0 177.0,30.0" fill="#E9EEF5"></polygon>
<line x1="247.0" y1="57.0" x2="247.0" y2="23.0" stroke="#E9EEF5" stroke-width="3" stroke-linecap="round"></line><circle cx="247.0" cy="21.0" r="4.5" fill="#FF4D5A"></circle>
<g style="display: ${P[0]}"><rect x="116.0" y="178.0" width="6" height="10" rx="3" fill="#E5484D"></rect><circle cx="119.0" cy="175.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[1]}"><rect x="134.0" y="185.0" width="6" height="10" rx="3" fill="#3A86FF"></rect><circle cx="137.0" cy="182.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[2]}"><rect x="147.0" y="194.5" width="6" height="10" rx="3" fill="#8B5CF6"></rect><circle cx="150.0" cy="191.5" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[3]}"><rect x="164.0" y="200.0" width="6" height="10" rx="3" fill="#2FA84F"></rect><circle cx="167.0" cy="197.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[4]}"><rect x="112.0" y="188.0" width="6" height="10" rx="3" fill="#F59E42"></rect><circle cx="115.0" cy="185.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[5]}"><rect x="126.0" y="197.0" width="6" height="10" rx="3" fill="#1A2547"></rect><circle cx="129.0" cy="194.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[6]}"><rect x="144.0" y="204.0" width="6" height="10" rx="3" fill="#D13438"></rect><circle cx="147.0" cy="201.0" r="3.2" fill="#F6D3B3"></circle></g>
<g style="display: ${P[7]}"><rect x="100.0" y="180.0" width="6" height="10" rx="3" fill="#2563C9"></rect><circle cx="103.0" cy="177.0" r="3.2" fill="#F6D3B3"></circle></g>
<rect x="292.5" y="176.0" width="5" height="14" fill="#7A4E2D"></rect><circle cx="295.0" cy="169.0" r="12" fill="#2FA84F"></circle><circle cx="291.0" cy="165.0" r="5" fill="#5BD27A"></circle>
<rect x="187.5" y="223.5" width="5" height="14" fill="#7A4E2D"></rect><circle cx="190.0" cy="216.5" r="12" fill="#2FA84F"></circle><circle cx="186.0" cy="212.5" r="5" fill="#5BD27A"></circle>
          </svg>`;
}
