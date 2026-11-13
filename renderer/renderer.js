const appRow = document.querySelector('#app-row');
const siteGroups = document.querySelector('#sites-groups');
const siteCount = document.querySelector('#site-count');
const siteDialog = document.querySelector('#site-dialog');
const appDialog = document.querySelector('#app-dialog');
const scanDialog = document.querySelector('#scan-dialog');
const groupDialog = document.querySelector('#group-dialog');
const backgroundDialog = document.querySelector('#background-dialog');
const siteForm = document.querySelector('#site-form');
const appForm = document.querySelector('#app-form');
const scanForm = document.querySelector('#scan-form');
const groupForm = document.querySelector('#group-form');
const backgroundForm = document.querySelector('#background-form');
const siteError = document.querySelector('#site-error');
const appError = document.querySelector('#app-error');
const scanError = document.querySelector('#scan-error');
const groupError = document.querySelector('#group-error');
const backgroundError = document.querySelector('#background-error');
const toast = document.querySelector('#toast');
const controllerButton = document.querySelector('#toggle-controller');
const fullscreenButton = document.querySelector('#toggle-fullscreen');
const controllerStatus = document.querySelector('#controller-status');
let state;
let editingSiteId = '';
let draggedSiteId = '';
let toastTimer;
let pendingSiteThumbnailPath = '';
let removeSiteThumbnail = false;
let scannedCandidates = [];

const navCooldowns = { left: 0, right: 0, up: 0, down: 0, activate: 0 };
const NAV_REPEAT_MS = 180;
const AXIS_THRESHOLD = 0.55;
const CONTROLLER_POLL_MS = 40;
let activeControllerIndex = -1;
const announcedControllers = new Set();
let lastControllerStatus = '';
const XBOX_CONTROLLER_PATTERN = /(xbox|xinput|x-box)/i;
const PREFERRED_CONTROLLER_PATTERN = /(xbox|xinput|wireless controller|gamepad|controller)/i;
const DEPRIORITIZED_DEVICE_PATTERN = /(speaker|headset|audio|microphone|hands-free|spk|conference|phone)/i;
let manualControllerIndex = -1;
let controllerActivity = new Map();

const appInitials = (title) => title.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const orderedSites = () => [...state.sites].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
const availableGroups = () => (Array.isArray(state?.groups) && state.groups.length > 0
  ? state.groups
  : [{ id: 'group-main', title: 'Main' }]);

function populateGroupSelect(select, selectedId = '') {
  select.replaceChildren();
  const groups = availableGroups();
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.title;
    if ((selectedId && group.id === selectedId) || (!selectedId && group === groups[0])) {
      option.selected = true;
    }
    select.append(option);
  }
}

function lightenColor(hex, amount) {
  const value = hex.replace('#', '');
  const channels = [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ].map((channel) => Math.min(255, Math.round(channel + ((255 - channel) * amount))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function applyBackground(color) {
  document.documentElement.style.setProperty('--dashboard-bg', color);
  document.documentElement.style.setProperty('--dashboard-bg-alt', lightenColor(color, 0.16));
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function setControllerStatus(message) {
  if (message === lastControllerStatus) {
    return;
  }
  lastControllerStatus = message;
  controllerStatus.textContent = `Controller: ${message}`;
}

function rememberControllerActivity(gamepad, now) {
  const activeButtons = (gamepad.buttons || []).some((button) => button?.pressed || (button?.value ?? 0) > 0.8);
  const activeAxes = (gamepad.axes || []).some((axis) => Math.abs(axis) > 0.35);
  if (activeButtons || activeAxes) {
    controllerActivity.set(gamepad.index, now);
  }
}

function controllerScore(gamepad, now) {
  const id = gamepad.id || '';
  let score = 0;

  if (XBOX_CONTROLLER_PATTERN.test(id)) {
    score += 260;
  }
  if (PREFERRED_CONTROLLER_PATTERN.test(id)) {
    score += 120;
  }
  if (/^hid\b/i.test(id) && !XBOX_CONTROLLER_PATTERN.test(id)) {
    score -= 70;
  }
  if (DEPRIORITIZED_DEVICE_PATTERN.test(id)) {
    score -= 220;
  }
  if (gamepad.mapping === 'standard') {
    score += 45;
  }
  score += (gamepad.buttons?.length ?? 0) * 2;
  score += (gamepad.axes?.length ?? 0) * 2;

  const lastActive = controllerActivity.get(gamepad.index) ?? 0;
  if (now - lastActive < 2500) {
    score += 160;
  }
  return score;
}

function listConnectedControllers() {
  const pollGamepads = navigator.getGamepads ?? navigator.webkitGetGamepads;
  if (!pollGamepads) {
    return [];
  }
  try {
    return Array.from(pollGamepads.call(navigator) || []).filter((gamepad) => gamepad && gamepad.connected);
  } catch {
    return [];
  }
}

function setControllerButtonLabel(pad) {
  if (manualControllerIndex < 0) {
    controllerButton.textContent = `Controller: Auto${pad ? ` (${pad.index + 1})` : ''}`;
  } else {
    controllerButton.textContent = `Controller: Locked ${manualControllerIndex + 1}`;
  }
}

function pickPreferredController(pads, now) {
  if (pads.length === 0) {
    return null;
  }

  if (manualControllerIndex >= 0) {
    return pads.find((gamepad) => gamepad.index === manualControllerIndex) ?? null;
  }

  return pads
    .map((gamepad) => ({ gamepad, score: controllerScore(gamepad, now) }))
    .sort((a, b) => b.score - a.score)[0].gamepad;
}

function setState(nextState) {
  state = nextState;
  render();
}

function makeButton(label, className, action, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', action);
  return button;
}

function getFocusableNavElements() {
  return [...document.querySelectorAll('.nav-primary, .app-tile, .site-tile')]
    .filter((element) => element.offsetParent !== null && !element.disabled);
}

function findClosestInDirection(current, direction) {
  const elements = getFocusableNavElements();
  if (elements.length === 0) {
    return null;
  }
  if (!current || !elements.includes(current)) {
    return elements[0];
  }

  const rect = current.getBoundingClientRect();
  const x = rect.left + (rect.width / 2);
  const y = rect.top + (rect.height / 2);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of elements) {
    if (candidate === current) {
      continue;
    }
    const box = candidate.getBoundingClientRect();
    const cx = box.left + (box.width / 2);
    const cy = box.top + (box.height / 2);
    const dx = cx - x;
    const dy = cy - y;

    const inDirection =
      (direction === 'left' && dx < -6) ||
      (direction === 'right' && dx > 6) ||
      (direction === 'up' && dy < -6) ||
      (direction === 'down' && dy > 6);
    if (!inDirection) {
      continue;
    }

    const distance = Math.hypot(dx, dy) + (Math.abs(direction === 'left' || direction === 'right' ? dy : dx) * 0.6);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function navigateDirection(direction) {
  const target = findClosestInDirection(document.activeElement, direction);
  if (target) {
    target.focus();
  }
}

function shouldHandleNavigationKeys(event) {
  if (siteDialog.open || appDialog.open || scanDialog.open || groupDialog.open || backgroundDialog.open) {
    return false;
  }
  const target = event.target;
  return !(target.closest('input, textarea, select, dialog'));
}

document.addEventListener('keydown', (event) => {
  if (!shouldHandleNavigationKeys(event)) {
    return;
  }
  const map = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down'
  };
  const direction = map[event.key];
  if (direction) {
    event.preventDefault();
    navigateDirection(direction);
  }
});

function controllerTick() {
  const pollGamepads = navigator.getGamepads ?? navigator.webkitGetGamepads;
  if (!pollGamepads) {
    setControllerStatus('gamepad API unavailable');
    window.setTimeout(controllerTick, 500);
    return;
  }

  let pads = [];
  try {
    pads = Array.from(pollGamepads.call(navigator) || []).filter(Boolean);
  } catch {
    setControllerStatus('read failed');
    window.setTimeout(controllerTick, 250);
    return;
  }
  const connectedPads = pads.filter((gamepad) => gamepad.connected);
  const now = performance.now();
  connectedPads.forEach((gamepad) => rememberControllerActivity(gamepad, now));
  const pad = pickPreferredController(connectedPads, now);
  setControllerButtonLabel(pad);
  if (pad && pad.index !== activeControllerIndex) {
    activeControllerIndex = pad.index;
    const controllerName = `${pad.id || 'Controller'} (slot ${pad.index + 1})`;
    if (!announcedControllers.has(controllerName)) {
      announcedControllers.add(controllerName);
      notify(`Controller ready: ${controllerName}`);
    }
  }

  if (!pad || siteDialog.open || appDialog.open || scanDialog.open || groupDialog.open || backgroundDialog.open) {
    setControllerStatus(pad ? `detected ${pad.id || 'controller'} on slot ${pad.index + 1} (dialog open)` : 'not detected');
    window.setTimeout(controllerTick, CONTROLLER_POLL_MS);
    return;
  }

  const axisX = pad.axes[0] ?? 0;
  const axisY = pad.axes[1] ?? 0;
  const axisRX = pad.axes[2] ?? 0;
  const axisRY = pad.axes[3] ?? 0;
  const dpadAxisX = pad.axes[6] ?? 0;
  const dpadAxisY = pad.axes[7] ?? 0;
  const hat = pad.axes[9] ?? 0.2;
  setControllerStatus(`active ${pad.id || 'controller'} on slot ${pad.index + 1}`);

  const directionSignals = {
    left: Boolean(pad.buttons[14]?.pressed || pad.buttons[4]?.pressed) || axisX < -AXIS_THRESHOLD || axisRX < -AXIS_THRESHOLD || dpadAxisX < -AXIS_THRESHOLD || (hat > -0.23 && hat < -0.05),
    right: Boolean(pad.buttons[15]?.pressed || pad.buttons[5]?.pressed) || axisX > AXIS_THRESHOLD || axisRX > AXIS_THRESHOLD || dpadAxisX > AXIS_THRESHOLD || (hat > 0.25 && hat < 0.55),
    up: Boolean(pad.buttons[12]?.pressed || pad.buttons[6]?.pressed) || axisY < -AXIS_THRESHOLD || axisRY < -AXIS_THRESHOLD || dpadAxisY < -AXIS_THRESHOLD || (hat < -0.6),
    down: Boolean(pad.buttons[13]?.pressed || pad.buttons[7]?.pressed) || axisY > AXIS_THRESHOLD || axisRY > AXIS_THRESHOLD || dpadAxisY > AXIS_THRESHOLD || (hat > 0.7)
  };

  for (const [direction, active] of Object.entries(directionSignals)) {
    if (active && now >= navCooldowns[direction]) {
      navigateDirection(direction);
      navCooldowns[direction] = now + NAV_REPEAT_MS;
    }
    if (!active) {
      navCooldowns[direction] = 0;
    }
  }

  const activatePressed = Boolean(pad.buttons[0]?.pressed || pad.buttons[1]?.pressed || pad.buttons[9]?.pressed);
  if (activatePressed && now >= navCooldowns.activate) {
    navCooldowns.activate = now + NAV_REPEAT_MS;
    const element = document.activeElement;
    if (element && (element.classList.contains('nav-primary') || element.classList.contains('app-tile') || element.classList.contains('site-tile'))) {
      element.click();
    }
  }
  if (!activatePressed) {
    navCooldowns.activate = 0;
  }

  window.setTimeout(controllerTick, CONTROLLER_POLL_MS);
}

function renderApps() {
  appRow.replaceChildren();
  const groups = availableGroups();
  const appsByGroup = new Map(groups.map((group) => [group.id, []]));
  for (const item of state.apps) {
    const targetGroup = appsByGroup.get(item.groupId) ?? appsByGroup.get(groups[0].id);
    targetGroup.push(item);
  }

  for (const group of groups) {
    const items = appsByGroup.get(group.id) ?? [];
    if (items.length === 0) {
      continue;
    }
    const section = document.createElement('section');
    section.className = 'site-group';
    const heading = document.createElement('h3');
    heading.className = 'group-heading';
    heading.textContent = group.title;
    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = String(items.length).padStart(2, '0');
    heading.append(count);

    const grid = document.createElement('div');
    grid.className = 'app-group-grid';
    for (const item of items) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'app-tile';
      tile.style.setProperty('--tile-color', item.color);
      tile.title = `Launch ${item.title}`;
      tile.setAttribute('aria-label', `Launch ${item.title}`);
      tile.addEventListener('click', async () => {
        try {
          await window.launcher.launchApp(item.id);
        } catch (error) {
          notify(`Couldn't launch ${item.title}: ${error.message}`);
        }
      });

      const iconShell = document.createElement('span');
      iconShell.className = 'app-icon-shell';
      const mark = document.createElement('span');
      mark.className = 'app-mark';
      mark.textContent = appInitials(item.title);
      if (item.icon) {
        const icon = document.createElement('img');
        icon.className = 'app-icon';
        icon.src = item.icon;
        icon.alt = '';
        iconShell.append(icon);
      } else {
        iconShell.append(mark);
      }
      const name = document.createElement('span');
      name.className = 'app-name';
      name.textContent = item.title;
      tile.append(iconShell, name);

      const iconEdit = makeButton('🖼', 'app-icon-edit', async (event) => {
        event.stopPropagation();
        try {
          const imagePath = await window.launcher.pickImage();
          if (!imagePath) {
            return;
          }
          setState(await window.launcher.updateAppIcon(item.id, imagePath));
          notify(`${item.title} icon updated.`);
        } catch (error) {
          notify(error.message);
        }
      }, `Change ${item.title} icon`);
      tile.append(iconEdit);

      if (item.hasCustomIcon) {
        tile.append(makeButton('↺', 'app-icon-clear', async (event) => {
          event.stopPropagation();
          try {
            setState(await window.launcher.clearAppIcon(item.id));
            notify(`${item.title} icon reset.`);
          } catch (error) {
            notify(error.message);
          }
        }, `Reset ${item.title} icon`));
      }

      if (!item.isDefault) {
        tile.append(makeButton('×', 'app-remove', async (event) => {
          event.stopPropagation();
          try {
            setState(await window.launcher.deleteApp(item.id));
            notify(`${item.title} removed.`);
          } catch (error) {
            notify(error.message);
          }
        }, `Remove ${item.title}`));
      }
      grid.append(tile);
    }
    section.append(heading, grid);
    appRow.append(section);
  }

  if (appRow.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Your app shortcuts belong here.';
    const description = document.createElement('p');
    description.textContent = 'Add an app manually or scan folders and pick apps to add.';
    content.append(title, description);
    empty.append(content);
    appRow.append(empty);
  }
}

function makeSiteTile(site, displayIndex, totalSites) {
  const tile = document.createElement('article');
  tile.className = 'site-tile';
  tile.setAttribute('role', 'button');
  tile.tabIndex = 0;
  tile.draggable = true;
  tile.dataset.siteId = site.id;
  tile.style.setProperty('--tile-color', site.color);
  tile.setAttribute('aria-label', `${site.title}; click to open, drag to rearrange`);

  const snapshot = document.createElement('span');
  snapshot.className = 'site-snapshot';
  if (site.thumbnail) {
    snapshot.style.backgroundImage = `url("${site.thumbnail}")`;
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'site-fallback';
    fallback.textContent = site.title.charAt(0).toUpperCase();
    tile.append(fallback);
  }

  const scrim = document.createElement('span');
  scrim.className = 'site-scrim';
  const title = document.createElement('span');
  title.className = 'site-title';
  title.textContent = site.title;

  const actions = document.createElement('span');
  actions.className = 'site-actions';
  actions.append(
    makeButton(site.pinned ? '★' : '☆', 'tile-action', async (event) => {
      event.stopPropagation();
      try {
        setState(await window.launcher.togglePin(site.id));
      } catch (error) {
        notify(error.message);
      }
    }, site.pinned ? 'Unpin website' : 'Pin website'),
    makeButton('↻', 'tile-action', async (event) => {
      event.stopPropagation();
      try {
        setState(await window.launcher.captureSite(site.id));
        notify(`Snapshot refreshed for ${site.title}.`);
      } catch (error) {
        notify(`Couldn't capture ${site.title}: ${error.message}`);
      }
    }, 'Refresh snapshot'),
    makeButton('⋯', 'tile-action', (event) => {
      event.stopPropagation();
      openSiteDialog(site);
    }, 'Edit website'),
    makeButton('×', 'tile-action', async (event) => {
      event.stopPropagation();
      if (!window.confirm(`Remove the ${site.title} tile?`)) {
        return;
      }
      try {
        setState(await window.launcher.deleteSite(site.id));
        notify(`${site.title} removed.`);
      } catch (error) {
        notify(error.message);
      }
    }, 'Remove website')
  );

  tile.append(snapshot, scrim, title, actions);
  tile.addEventListener('click', async () => {
    try {
      await window.launcher.openSite(site.id);
    } catch (error) {
      notify(`Couldn't open ${site.title}: ${error.message}`);
    }
  });
  tile.addEventListener('keydown', (event) => {
    if (event.target === tile && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      tile.click();
    }
  });
  tile.addEventListener('dragstart', (event) => {
    draggedSiteId = site.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', site.id);
    requestAnimationFrame(() => tile.classList.add('dragging'));
  });
  tile.addEventListener('dragend', () => {
    draggedSiteId = '';
    tile.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach((element) => element.classList.remove('drop-target'));
  });
  tile.addEventListener('dragover', (event) => {
    if (draggedSiteId && draggedSiteId !== site.id) {
      event.preventDefault();
      tile.classList.add('drop-target');
    }
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop-target'));
  tile.addEventListener('drop', async (event) => {
    event.preventDefault();
    tile.classList.remove('drop-target');
    const sourceId = event.dataTransfer.getData('text/plain') || draggedSiteId;
    if (!sourceId || sourceId === site.id) {
      return;
    }
    const ids = orderedSites().map((entry) => entry.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(site.id);
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    try {
      setState(await window.launcher.reorderSites(ids));
    } catch (error) {
      notify(error.message);
    }
  });

  const positionActions = document.createElement('div');
  positionActions.className = 'tile-position-actions';
  positionActions.append(
    makeButton('↑', 'tile-action', async (event) => {
      event.stopPropagation();
      await moveSite(site.id, -1);
    }, `Move ${site.title} earlier`),
    makeButton('↓', 'tile-action', async (event) => {
      event.stopPropagation();
      await moveSite(site.id, 1);
    }, `Move ${site.title} later`)
  );
  positionActions.children[0].disabled = displayIndex === 0;
  positionActions.children[1].disabled = displayIndex === totalSites - 1;
  positionActions.hidden = displayIndex === 0 && totalSites === 1;
  actions.append(positionActions);
  return tile;
}

async function moveSite(siteId, direction) {
  const ids = orderedSites().map((site) => site.id);
  const from = ids.indexOf(siteId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) {
    return;
  }
  ids.splice(from, 1);
  ids.splice(to, 0, siteId);
  try {
    setState(await window.launcher.reorderSites(ids));
  } catch (error) {
    notify(error.message);
  }
}

function makeGroup(title, sites) {
  const group = document.createElement('section');
  group.className = 'site-group';
  const heading = document.createElement('h3');
  heading.className = 'group-heading';
  heading.textContent = title;
  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = String(sites.length).padStart(2, '0');
  heading.append(count);
  const grid = document.createElement('div');
  grid.className = 'site-grid';
  const allSites = orderedSites();
  sites.forEach((site) => grid.append(makeSiteTile(site, allSites.findIndex((entry) => entry.id === site.id), allSites.length)));
  group.append(heading, grid);
  return group;
}

function renderSites() {
  const sites = orderedSites();
  siteCount.textContent = `${sites.length} ${sites.length === 1 ? 'website' : 'websites'}`;
  siteGroups.replaceChildren();
  if (sites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Your favorite sites belong here.';
    const description = document.createElement('p');
    description.textContent = 'Add a website to create a colorful tile with a captured site snapshot.';
    content.append(title, description);
    empty.append(content);
    siteGroups.append(empty);
    return;
  }

  const groups = availableGroups();
  const groupedSites = new Map(groups.map((group) => [group.id, []]));
  for (const site of sites) {
    const bucket = groupedSites.get(site.groupId) ?? groupedSites.get(groups[0].id);
    bucket.push(site);
  }

  for (const group of groups) {
    const entries = groupedSites.get(group.id) ?? [];
    if (entries.length) {
      siteGroups.append(makeGroup(group.title, entries));
    }
  }
}

function render() {
  applyBackground(state.settings?.backgroundColor ?? '#101821');
  renderApps();
  renderSites();
}

function openSiteDialog(site = null) {
  editingSiteId = site?.id ?? '';
  pendingSiteThumbnailPath = '';
  removeSiteThumbnail = false;
  document.querySelector('#site-dialog-title').textContent = site ? 'Edit website' : 'Add a website';
  document.querySelector('#site-submit').textContent = site ? 'Save changes' : 'Add website';
  document.querySelector('#site-title').value = site?.title ?? '';
  document.querySelector('#site-url').value = site?.url ?? '';
  populateGroupSelect(document.querySelector('#site-group'), site?.groupId ?? '');
  document.querySelector('#site-open-in-launcher').checked = Boolean(site?.openInLauncher);
  document.querySelector('#site-thumbnail-path').value = site?.hasCustomThumbnail ? 'Using custom thumbnail' : '';
  siteError.textContent = '';
  siteDialog.showModal();
  document.querySelector('#site-title').focus();
}

function closeDialogs() {
  siteDialog.close();
  appDialog.close();
  scanDialog.close();
  groupDialog.close();
  backgroundDialog.close();
}

document.querySelector('#add-site').addEventListener('click', () => openSiteDialog());
document.querySelector('#add-app').addEventListener('click', () => {
  appError.textContent = '';
  appForm.reset();
  document.querySelector('#app-icon-path').value = '';
  populateGroupSelect(document.querySelector('#app-group'));
  appDialog.showModal();
  document.querySelector('#app-title').focus();
});
document.querySelector('#scan-apps').addEventListener('click', () => {
  scanError.textContent = '';
  scannedCandidates = [];
  document.querySelector('#scan-folders').value = '';
  document.querySelector('#scan-results').replaceChildren();
  populateGroupSelect(document.querySelector('#scan-group'));
  scanDialog.showModal();
});
document.querySelector('#add-group').addEventListener('click', () => {
  groupError.textContent = '';
  groupForm.reset();
  groupDialog.showModal();
  document.querySelector('#group-title').focus();
});
document.querySelector('#background-settings').addEventListener('click', () => {
  backgroundError.textContent = '';
  document.querySelector('#background-color').value = state.settings?.backgroundColor ?? '#101821';
  backgroundDialog.showModal();
});

controllerButton.addEventListener('click', () => {
  const pads = listConnectedControllers();
  if (pads.length === 0) {
    manualControllerIndex = -1;
    setControllerButtonLabel(null);
    notify('No connected controllers detected.');
    return;
  }

  const sorted = pads
    .map((gamepad) => ({ gamepad, score: controllerScore(gamepad, performance.now()) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.gamepad);

  if (manualControllerIndex < 0) {
    manualControllerIndex = sorted[0].index;
  } else {
    const currentPosition = sorted.findIndex((gamepad) => gamepad.index === manualControllerIndex);
    const nextPosition = currentPosition < 0 || currentPosition === sorted.length - 1 ? -1 : currentPosition + 1;
    manualControllerIndex = nextPosition < 0 ? -1 : sorted[nextPosition].index;
  }

  const chosen = manualControllerIndex < 0 ? null : pads.find((gamepad) => gamepad.index === manualControllerIndex);
  setControllerButtonLabel(chosen ?? null);
  notify(chosen ? `Controller locked to slot ${chosen.index + 1}: ${chosen.id || 'Controller'}` : 'Controller mode set to Auto.');
});

fullscreenButton.addEventListener('click', async () => {
  try {
    const isFull = await window.launcher.toggleFullscreen();
    fullscreenButton.textContent = isFull ? 'Exit full screen' : 'Full screen';
  } catch (error) {
    notify(error.message);
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', closeDialogs);
});

siteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = {
    title: document.querySelector('#site-title').value,
    url: document.querySelector('#site-url').value,
    groupId: document.querySelector('#site-group').value,
    openInLauncher: document.querySelector('#site-open-in-launcher').checked,
    thumbnailPath: pendingSiteThumbnailPath,
    removeThumbnail: removeSiteThumbnail
  };
  try {
    const result = editingSiteId
      ? await window.launcher.updateSite({ ...input, id: editingSiteId })
      : await window.launcher.addSite(input);
    setState(result.state);
    siteDialog.close();
    notify(result.previewError
      ? `Website saved, but its snapshot couldn't be captured: ${result.previewError}`
      : editingSiteId ? 'Website tile updated.' : 'Website added with a new snapshot.');
  } catch (error) {
    siteError.textContent = error.message;
  }
});

appForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setState(await window.launcher.addApp({
      title: document.querySelector('#app-title').value,
      target: document.querySelector('#app-target').value,
      groupId: document.querySelector('#app-group').value,
      iconPath: document.querySelector('#app-icon-path').value
    }));
    appDialog.close();
    notify('App shortcut added.');
  } catch (error) {
    appError.textContent = error.message;
  }
});

function parseScanFolderInput(value) {
  return value
    .split(/[\r\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderScanCandidates(candidates) {
  const host = document.querySelector('#scan-results');
  host.replaceChildren();
  if (candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-note';
    empty.textContent = 'No .exe or .lnk files were found in the selected folders.';
    host.append(empty);
    return;
  }
  for (const candidate of candidates) {
    const row = document.createElement('label');
    row.className = 'scan-result-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = candidate.target;
    checkbox.checked = !candidate.alreadyAdded;
    checkbox.disabled = candidate.alreadyAdded;
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'scan-result-title';
    title.textContent = candidate.alreadyAdded ? `${candidate.title} (already added)` : candidate.title;
    const pathText = document.createElement('div');
    pathText.className = 'scan-result-path';
    pathText.textContent = candidate.target;
    text.append(title, pathText);
    row.append(checkbox, text);
    host.append(row);
  }
}

groupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setState(await window.launcher.addGroup(document.querySelector('#group-title').value));
    groupDialog.close();
    notify('Group created.');
  } catch (error) {
    groupError.textContent = error.message;
  }
});

scanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const selectedTargets = new Set(
      [...document.querySelectorAll('#scan-results input[type="checkbox"]:checked')]
        .map((input) => input.value)
    );
    const selections = scannedCandidates
      .filter((candidate) => selectedTargets.has(candidate.target))
      .map((candidate) => ({ title: candidate.title, target: candidate.target }));
    const result = await window.launcher.addScannedApps({
      groupId: document.querySelector('#scan-group').value,
      selections
    });
    setState(result.state);
    scanDialog.close();
    notify(`Added ${result.added} app${result.added === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} skipped)` : ''}.`);
  } catch (error) {
    scanError.textContent = error.message;
  }
});

document.querySelector('#browse-scan-folders').addEventListener('click', async () => {
  try {
    const folders = await window.launcher.pickAppFolders();
    if (folders.length > 0) {
      document.querySelector('#scan-folders').value = folders.join('; ');
    }
  } catch (error) {
    scanError.textContent = error.message;
  }
});

document.querySelector('#run-app-scan').addEventListener('click', async () => {
  scanError.textContent = '';
  try {
    const folders = parseScanFolderInput(document.querySelector('#scan-folders').value);
    const result = await window.launcher.scanAppFolders(folders);
    document.querySelector('#scan-folders').value = result.folders.join('; ');
    scannedCandidates = result.candidates;
    renderScanCandidates(scannedCandidates);
    notify(`Found ${scannedCandidates.length} app file${scannedCandidates.length === 1 ? '' : 's'}.`);
  } catch (error) {
    scanError.textContent = error.message;
  }
});

backgroundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setState(await window.launcher.updateBackground(document.querySelector('#background-color').value));
    backgroundDialog.close();
    notify('Background color updated.');
  } catch (error) {
    backgroundError.textContent = error.message;
  }
});

document.querySelector('#background-presets').addEventListener('click', (event) => {
  const swatch = event.target.closest('.preset-swatch');
  if (!swatch) {
    return;
  }
  document.querySelector('#background-color').value = swatch.dataset.color;
});

document.querySelector('#browse-app').addEventListener('click', async () => {
  try {
    const target = await window.launcher.pickApp();
    if (target) {
      document.querySelector('#app-target').value = target;
    }
  } catch (error) {
    appError.textContent = error.message;
  }
});

document.querySelector('#browse-app-icon').addEventListener('click', async () => {
  try {
    const iconPath = await window.launcher.pickImage();
    if (iconPath) {
      document.querySelector('#app-icon-path').value = iconPath;
    }
  } catch (error) {
    appError.textContent = error.message;
  }
});

document.querySelector('#browse-site-thumbnail').addEventListener('click', async () => {
  try {
    const imagePath = await window.launcher.pickImage();
    if (imagePath) {
      pendingSiteThumbnailPath = imagePath;
      removeSiteThumbnail = false;
      document.querySelector('#site-thumbnail-path').value = imagePath;
    }
  } catch (error) {
    siteError.textContent = error.message;
  }
});

document.querySelector('#clear-site-thumbnail').addEventListener('click', () => {
  pendingSiteThumbnailPath = '';
  removeSiteThumbnail = true;
  document.querySelector('#site-thumbnail-path').value = '';
});

document.querySelector('#refresh-previews').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Refreshing…';
  try {
    const result = await window.launcher.refreshPreviews();
    setState(result.state);
    notify(result.failures.length
      ? `Refreshed with ${result.failures.length} site snapshot${result.failures.length === 1 ? '' : 's'} unavailable.`
      : 'All website snapshots refreshed.');
  } catch (error) {
    notify(`Couldn't refresh snapshots: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh snapshots';
  }
});

window.addEventListener('gamepadconnected', (event) => {
  const gamepad = event.gamepad;
  activeControllerIndex = gamepad.index;
  notify(`Controller connected: ${gamepad.id || 'Xbox controller'} (slot ${gamepad.index + 1})`);
  setControllerStatus(`connected on slot ${gamepad.index + 1}`);
  setControllerButtonLabel(gamepad);
});

window.addEventListener('gamepaddisconnected', (event) => {
  const gamepad = event.gamepad;
  notify(`Controller disconnected: slot ${gamepad.index + 1}`);
  if (activeControllerIndex === gamepad.index) {
    activeControllerIndex = -1;
  }
  if (manualControllerIndex === gamepad.index) {
    manualControllerIndex = -1;
  }
  setControllerStatus('disconnected');
  setControllerButtonLabel(null);
});

window.setTimeout(controllerTick, CONTROLLER_POLL_MS);
window.addEventListener('focus', () => {
  window.setTimeout(controllerTick, 0);
});
window.addEventListener('click', () => {
  window.setTimeout(controllerTick, 0);
});

window.launcher.getState().then((loadedState) => {
  setState(loadedState);
  setControllerButtonLabel(null);
  const navElements = getFocusableNavElements();
  navElements[0]?.focus();
}).catch((error) => {
  notify(`Couldn't load launcher data: ${error.message}`);
});
