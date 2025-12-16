(function oneko() {
  const nekoEl = document.createElement("div");
  let nekoPosX = 32;
  let nekoPosY = 32;
  let mousePosX = 0;
  let mousePosY = 0;
  let frameCount = 0;
  let idleTime = 0;
  let idleAnimation = null;
  let idleAnimationFrame = 0;
  
  const NEKO_SPEED = 10;
  // Sprite definitions
  const SPRITE_SETS = {
    idle: [[-3, -3]],
    alert: [[-7, -3]],
    scratchSelf: [[-5, 0], [-6, 0], [-7, 0]],
    scratchWallN: [[0, 0], [0, -1]],
    scratchWallS: [[-7, -1], [-6, -2]],
    scratchWallE: [[-2, -2], [-2, -3]],
    scratchWallW: [[-4, 0], [-4, -1]],
    tired: [[-3, -2]],
    sleeping: [[-2, 0], [-2, -1]],
    N: [[-1, -2], [-1, -3]],
    NE: [[0, -2], [0, -3]],
    E: [[-3, 0], [-3, -1]],
    SE: [[-5, -1], [-5, -2]],
    S: [[-6, -3], [-7, -2]],
    SW: [[-5, -3], [-6, -1]],
    W: [[-4, -2], [-4, -3]],
    NW: [[-1, 0], [-1, -1]],
  };

  function create() {
    const header = document.querySelector('header');
    if (!header) return;

    nekoEl.id = "oneko";
    nekoEl.style.width = "32px";
    nekoEl.style.height = "32px";
    nekoEl.style.position = "absolute";
    nekoEl.style.bottom = "0"; // Sit on the ground (border-bottom)
    nekoEl.style.pointerEvents = "none";
    nekoEl.style.backgroundImage = "url('public/images/oneko.gif')";
    nekoEl.style.imageRendering = "pixelated";
    nekoEl.style.zIndex = "10";
    
    // Initial position
    nekoPosX = header.clientWidth / 2;
    // We only care about X for "walking on the ground" effect, 
    // Let's treat Y as 0 relative to bottom.
    
    nekoEl.style.left = `${nekoPosX - 16}px`;
    
    header.appendChild(nekoEl);

    document.addEventListener("mousemove", (e) => {
      mousePosX = e.clientX;
      mousePosY = e.clientY;
    });

    window.requestAnimationFrame(onAnimationFrame);
  }

  let lastFrameTimestamp;

  function onAnimationFrame(timestamp) {
    if (!lastFrameTimestamp) lastFrameTimestamp = timestamp;
    if (timestamp - lastFrameTimestamp > 100) {
      lastFrameTimestamp = timestamp;
      frame();
    }
    window.requestAnimationFrame(onAnimationFrame);
  }

  function setSprite(name, frame) {
    const sprite = SPRITE_SETS[name][frame % SPRITE_SETS[name].length];
    nekoEl.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
  }

  function resetIdleAnimation() {
    idleAnimation = null;
    idleAnimationFrame = 0;
  }

  function idle() {
    idleTime += 1;
    if (
      idleTime > 10 &&
      Math.floor(Math.random() * 200) == 0 &&
      idleAnimation == null
    ) {
      idleAnimation = ["sleeping", "scratchSelf"][
        Math.floor(Math.random() * 2)
      ];
    }

    switch (idleAnimation) {
      case "sleeping":
        if (idleAnimationFrame < 8) {
          setSprite("tired", 0);
          break;
        }
        setSprite("sleeping", Math.floor(idleAnimationFrame / 4));
        if (idleAnimationFrame > 192) {
          resetIdleAnimation();
        }
        break;
      case "scratchSelf":
        setSprite("scratchSelf", idleAnimationFrame);
        if (idleAnimationFrame > 9) {
          resetIdleAnimation();
        }
        break;
      default:
        setSprite("idle", 0);
        return;
    }
    idleAnimationFrame += 1;
  }

  function frame() {
    frameCount += 1;
    
    const header = document.querySelector('header');
    if (!header) return;
    
    // Logic: Follow the mouse.
    // Cat moves towards the mouse cursor X position.
    
    // Calculate mouse position relative to header
    const headerRect = header.getBoundingClientRect();
    const relativeMouseX = mousePosX - headerRect.left;
    
    // Target X is the mouse position, clamped to header bounds
    let targetX = Math.min(Math.max(16, relativeMouseX), header.clientWidth - 16);
    
    // Y is constant (on the ground)
    const targetY = 0; 
    
    const diffX = nekoPosX - targetX;
    // We ignore Y difference for movement calculation since we are constrained to 1D
    const distance = Math.abs(diffX);

    if (distance < NEKO_SPEED || distance < 10) {
      idle();
      return;
    }

    idleAnimation = null;
    idleAnimationFrame = 0;

    if (idleTime > 1) {
      setSprite("alert", 0);
      // Wait
      idleTime = Math.min(idleTime, 7);
      idleTime -= 1;
      return;
    }

    let direction = "";
    // Vertical is ignored
    // direction += diffY / distance > 0.5 ? "N" : "";
    // direction += diffY / distance < -0.5 ? "S" : "";
    
    // Horizontal
    if (diffX > 0) {
        direction = "W"; // Target is to the Left (West)
    } else {
        direction = "E"; // Target is to the Right (East)
    }
    
    setSprite(direction, frameCount);

    // Update Position
    // Move towards target
    if (diffX > 0) {
         nekoPosX -= NEKO_SPEED;
    } else {
         nekoPosX += NEKO_SPEED;
    }

    nekoPosX = Math.min(Math.max(16, nekoPosX), header.clientWidth - 16);
    // Y is fixed at bottom 0 via CSS, but if we need sprite selection based on 2D in future...
    
    nekoEl.style.left = `${nekoPosX - 16}px`;
  }

  create();
})();
