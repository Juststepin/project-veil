import './style.css';

const SYSTEM_BOOT_MESSAGE =
  '[HỆ THỐNG]: Bộ lọc nhận thức hoạt động bình thường. Mục tiêu: Dọn sạch Undead.';

interface ArchitectureLayer {
  path: string;
  role: string;
}

const ARCHITECTURE_LAYERS: ArchitectureLayer[] = [
  { path: 'src/data/', role: 'Dữ liệu tĩnh JSON' },
  { path: 'src/core/', role: 'Logic game thuần TS' },
  { path: 'src/perception/', role: 'Bộ lọc thật / giả' },
  { path: 'src/ui/', role: 'Canvas & điều khiển' },
];

function renderBootScreen(container: HTMLElement): void {
  const layerItemsHtml = ARCHITECTURE_LAYERS.map(
    (layer) => `
      <li class="layer-item">
        <span class="layer-path">${layer.path}</span>
        <span class="layer-role">${layer.role}</span>
      </li>
    `,
  ).join('');

  container.innerHTML = `
    <section class="veil-shell" aria-label="Kiểm thử khởi động Project VEIL">
      <header class="veil-header">
        <p class="veil-eyebrow">Giai đoạn 1 · Bước 1</p>
        <h1 class="veil-title">Project VEIL</h1>
        <p class="veil-subtitle">
          Khung dự án TypeScript + Vite đã sẵn sàng trên trình duyệt di động.
        </p>
      </header>

      <article class="system-panel">
        <div class="panel-header">
          <span>PERCEPTION_FILTER_v0.1</span>
          <span class="status-tag">ONLINE</span>
        </div>

        <p id="system-message" class="system-message" role="status"></p>

        <ul class="layer-list" aria-label="Cấu trúc 4 thư mục kiến trúc">
          ${layerItemsHtml}
        </ul>

        <button id="touch-check-btn" class="touch-check-btn" type="button">
          Kiểm tra cảm ứng trên thiết bị
        </button>
        <p id="touch-feedback" class="touch-feedback" aria-live="polite"></p>
      </article>
    </section>
  `;

  const messageElement = container.querySelector<HTMLParagraphElement>('#system-message');
  if (messageElement) {
    messageElement.textContent = SYSTEM_BOOT_MESSAGE;
  }

  const touchButton = container.querySelector<HTMLButtonElement>('#touch-check-btn');
  const feedbackElement = container.querySelector<HTMLParagraphElement>('#touch-feedback');

  let tapCount = 0;
  touchButton?.addEventListener('click', () => {
    tapCount += 1;
    if (feedbackElement) {
      feedbackElement.textContent = `Tín hiệu đầu vào ổn định (${tapCount} lần chạm · ${window.innerWidth}x${window.innerHeight}px)`;
    }
  });
}

const appRoot = document.querySelector<HTMLElement>('#app');
if (appRoot) {
  renderBootScreen(appRoot);
}
