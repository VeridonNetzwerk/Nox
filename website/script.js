/* ==========================================================================
   NOX — Console Scripts
   ========================================================================== */

// ============== BOOT SEQUENCE ==============

(function bootSequence() {
  const boot = document.getElementById('boot');
  if (!boot) return;

  const lines = boot.querySelectorAll('.boot-line');
  lines.forEach((line) => {
    const delay = parseInt(line.dataset.delay || 0);
    setTimeout(() => line.classList.add('show'), delay);
  });

  setTimeout(() => {
    boot.classList.add('done');
  }, 2200);
})();

// ============== CONSTELLATION CANVAS ==============

(function constellation() {
  const canvas = document.getElementById('constellation');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let nodes = [];
  let w, h;
  const NODE_COUNT = 60;
  const MAX_DIST = 140;
  const MOUSE_DIST = 200;

  let mouse = { x: -1000, y: -1000 };

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function initNodes() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        pulse: Math.random() * Math.PI * 2,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Update + draw nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;
      n.pulse += 0.02;

      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;

      const alpha = 0.3 + Math.sin(n.pulse) * 0.15;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 102, 241, ${alpha})`;
      ctx.fill();
    }

    // Draw connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < MAX_DIST) {
          const alpha = (1 - dist / MAX_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Mouse connections
      const mdx = nodes[i].x - mouse.x;
      const mdy = nodes[i].y - mouse.y;
      const mdist = Math.sqrt(mdx * mdx + mdy * mdy);

      if (mdist < MOUSE_DIST) {
        const alpha = (1 - mdist / MOUSE_DIST) * 0.3;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = `rgba(0, 255, 159, ${alpha})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => {
    resize();
    initNodes();
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  window.addEventListener('mouseleave', () => {
    mouse.x = -1000;
    mouse.y = -1000;
  });

  resize();
  initNodes();
  draw();
})();

// ============== NAV SCROLL ==============

const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
});

// ============== MOBILE MENU ==============

const burger = document.querySelector('.nav-burger');
const mobileMenu = document.querySelector('.nav-mobile');
burger.addEventListener('click', () => {
  burger.classList.toggle('open');
  mobileMenu.classList.toggle('open');
});

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    burger.classList.remove('open');
    mobileMenu.classList.remove('open');
  });
});

// ============== SCROLL REVEAL ==============

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  },
  { threshold: 0.1 }
);

document.querySelectorAll(
  '.module-card, .install-step, .query-item, .privacy-item, .download-panel, .tech-terminal, .privacy-diagram'
).forEach((el) => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});

// ============== DOWNLOAD BUTTON ==============
// Download button now links directly to GitHub releases — no JS intercept needed.
