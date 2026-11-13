const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { OFFICE_APP_TARGETS, officeExecutableCandidates } = require('./app-targets.cjs');
const { normalizeSiteUrl, validateAppTarget, validateHexColor, validateTitle } = require('./validation.cjs');

const SITE_COLORS = ['#1d78d5', '#cb4c65', '#248b76', '#774fc4', '#c4771e', '#3979a8', '#9a4d94'];
const DEFAULT_BACKGROUND_COLOR = '#101821';
const DEFAULT_GROUP_ID = 'group-main';
const DEFAULT_GROUP_TITLE = 'Main';
const APP_SCAN_EXTENSIONS = new Set(['.exe', '.lnk']);
const APP_BRAND_ICON_DATA = Object.freeze({
  'app-office': iconCardDataUrl('#d94b42', '365', '#f9d7cb'),
  'app-outlook': iconCardDataUrl('#1875d1', 'O', '#d5e8ff'),
  'app-word': iconCardDataUrl('#185abd', 'W', '#d5e8ff'),
  'app-excel': iconCardDataUrl('#107c41', 'X', '#d8f2e4'),
  'app-powerpoint': iconCardDataUrl('#c43e1c', 'P', '#ffe0d3'),
  'app-teams': iconCardDataUrl('#5b5fc7', 'T', '#dddfff'),
  'app-copilot': iconCardDataUrl('#6854c7', '∞', '#efe7ff')
});
const APP_ICON_GLYPHS = Object.freeze({
  'app-office': '365',
  'app-outlook': 'O',
  'app-word': 'W',
  'app-excel': 'X',
  'app-powerpoint': 'P',
  'app-teams': 'T',
  'app-copilot': 'C'
});

app.commandLine.appendSwitch('enable-gamepad-button-axis-events');
const DEFAULT_APPS = [
  { id: 'app-office', title: 'Office', target: 'https://www.microsoft365.com', color: '#d94b42' },
  { id: 'app-outlook', title: 'Outlook', target: OFFICE_APP_TARGETS['app-outlook'].fallback, color: '#1875d1' },
  { id: 'app-word', title: 'Word', target: OFFICE_APP_TARGETS['app-word'].fallback, color: '#185abd' },
  { id: 'app-excel', title: 'Excel', target: OFFICE_APP_TARGETS['app-excel'].fallback, color: '#107c41' },
  { id: 'app-powerpoint', title: 'PowerPoint', target: OFFICE_APP_TARGETS['app-powerpoint'].fallback, color: '#c43e1c' },
  { id: 'app-teams', title: 'Teams', target: 'msteams:', color: '#5b5fc7' },
  { id: 'app-copilot', title: 'Copilot', target: 'https://copilot.microsoft.com', color: '#6854c7' }
].map((entry) => ({ ...entry, isDefault: true }));

let mainWindow;
let state;
let statePath;
let previewsPath;
let siteMediaPath;
let appMediaPath;
let writeQueue = Promise.resolve();
const siteWindows = new Set();
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

function glyphIconDataUrl(glyph) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="rgba(255,255,255,0.22)"/><text x="64" y="72" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${glyph}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function iconCardDataUrl(background, glyph, plate) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${background}"/><stop offset="1" stop-color="#111a2b"/></linearGradient></defs><rect width="128" height="128" rx="24" fill="url(#g)"/><rect x="21" y="21" width="86" height="86" rx="18" fill="rgba(0,0,0,0.2)"/><rect x="32" y="31" width="64" height="64" rx="14" fill="${plate}"/><text x="64" y="76" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="44" font-weight="700" fill="${background}">${glyph}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function newState() {
  return {
    groups: [{ id: DEFAULT_GROUP_ID, title: DEFAULT_GROUP_TITLE }],
    sites: [],
    apps: DEFAULT_APPS.map((entry) => ({ ...entry, groupId: DEFAULT_GROUP_ID })),
    settings: { backgroundColor: DEFAULT_BACKGROUND_COLOR }
  };
}

function migrateState() {
  let changed = false;
  if (!Array.isArray(state.groups)) {
    state.groups = [{ id: DEFAULT_GROUP_ID, title: DEFAULT_GROUP_TITLE }];
    changed = true;
  } else {
    const normalizedGroups = [];
    const seen = new Set();
    for (const group of state.groups) {
      if (!group || typeof group.id !== 'string' || typeof group.title !== 'string') {
        changed = true;
        continue;
      }
      const id = group.id.trim();
      if (!/^[a-z\d-]{1,80}$/i.test(id) || seen.has(id)) {
        changed = true;
        continue;
      }
      const title = validateTitle(group.title);
      normalizedGroups.push({ id, title });
      seen.add(id);
    }
    if (normalizedGroups.length === 0) {
      normalizedGroups.push({ id: DEFAULT_GROUP_ID, title: DEFAULT_GROUP_TITLE });
      changed = true;
    }
    state.groups = normalizedGroups;
  }
  const groupIds = new Set(state.groups.map((group) => group.id));

  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = { backgroundColor: DEFAULT_BACKGROUND_COLOR };
    changed = true;
  }

  const backgroundColor = state.settings.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const normalizedColor = validateHexColor(backgroundColor, 'background color');
  if (backgroundColor !== normalizedColor) {
    state.settings.backgroundColor = normalizedColor;
    changed = true;
  }

  for (const site of state.sites) {
    if (!Object.prototype.hasOwnProperty.call(site, 'customThumbnail')) {
      site.customThumbnail = '';
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(site, 'openInLauncher')) {
      site.openInLauncher = false;
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(site, 'groupId') || typeof site.groupId !== 'string' ||
        !groupIds.has(site.groupId)) {
      site.groupId = DEFAULT_GROUP_ID;
      changed = true;
    }
  }

  for (const item of state.apps) {
    if (!Object.prototype.hasOwnProperty.call(item, 'customIcon')) {
      item.customIcon = '';
      changed = true;
    }
    if (!Object.prototype.hasOwnProperty.call(item, 'groupId') || typeof item.groupId !== 'string' ||
        !groupIds.has(item.groupId)) {
      item.groupId = DEFAULT_GROUP_ID;
      changed = true;
    }
  }
  return changed;
}

function assertState(value) {
  if (!value || !Array.isArray(value.groups) || !Array.isArray(value.sites) || !Array.isArray(value.apps) || !value.settings ||
      typeof value.settings !== 'object') {
    throw new TypeError('The launcher data file has an invalid format.');
  }
  if (value.groups.length === 0) {
    throw new TypeError('At least one group is required.');
  }
  const groupIds = new Set();
  for (const group of value.groups) {
    if (!group || typeof group.id !== 'string' || typeof group.title !== 'string' ||
        !/^[a-z\d-]{1,80}$/i.test(group.id)) {
      throw new TypeError('A group entry in the launcher data file is invalid.');
    }
    validateTitle(group.title);
    if (groupIds.has(group.id)) {
      throw new TypeError('A duplicate group id exists in the launcher data file.');
    }
    groupIds.add(group.id);
  }
  validateHexColor(value.settings.backgroundColor, 'background color');

  for (const site of value.sites) {
    if (!site || typeof site.id !== 'string' || !/^[\da-f-]{36}$/i.test(site.id) ||
        typeof site.title !== 'string' ||
        typeof site.url !== 'string' || typeof site.pinned !== 'boolean' ||
        !Number.isInteger(site.order) || !/^#[\da-f]{6}$/i.test(site.color) ||
        typeof site.customThumbnail !== 'string' || typeof site.openInLauncher !== 'boolean' ||
        typeof site.groupId !== 'string' || !groupIds.has(site.groupId)) {
      throw new TypeError('A website entry in the launcher data file is invalid.');
    }
    normalizeSiteUrl(site.url);
    validateTitle(site.title);
  }

  for (const item of value.apps) {
    if (!item || typeof item.id !== 'string' || !/^[a-z\d-]{1,80}$/i.test(item.id) ||
        typeof item.title !== 'string' || typeof item.target !== 'string' ||
        typeof item.color !== 'string' || !/^#[\da-f]{6}$/i.test(item.color) ||
        typeof item.isDefault !== 'boolean' || typeof item.customIcon !== 'string' ||
        typeof item.groupId !== 'string' || !groupIds.has(item.groupId)) {
      throw new TypeError('An app entry in the launcher data file is invalid.');
    }
    validateAppTarget(item.target);
    validateTitle(item.title);
  }
}

async function saveState() {
  const serialized = JSON.stringify(state, null, 2);
  const temporaryPath = `${statePath}.tmp`;
  writeQueue = writeQueue.then(async () => {
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    await fs.rename(temporaryPath, statePath);
  });
  return writeQueue;
}

async function loadState() {
  let isNewState = false;
  let migratedState = false;
  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    migratedState = migrateState();
    assertState(state);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    state = newState();
    isNewState = true;
  }

  const targetsChanged = await reconcileOfficeTargets();
  if (isNewState || migratedState || targetsChanged) {
    await saveState();
  }
}

async function reconcileOfficeTargets() {
  let changed = false;
  for (const item of state.apps) {
    const officeTarget = OFFICE_APP_TARGETS[item.id];
    if (!item.isDefault || !officeTarget) {
      continue;
    }

    let target = officeTarget.fallback;
    for (const candidate of officeExecutableCandidates(item.id)) {
      try {
        if ((await fs.stat(candidate)).isFile()) {
          target = candidate;
          break;
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
          throw error;
        }
      }
    }

    if (item.target !== target) {
      item.target = target;
      changed = true;
    }
  }
  return changed;
}

function previewPath(siteId) {
  return path.join(previewsPath, `${siteId}.jpg`);
}

function customSiteImagePath(fileName) {
  return path.join(siteMediaPath, fileName);
}

function customAppIconPath(fileName) {
  return path.join(appMediaPath, fileName);
}

function imageMimeType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  return `image/${extension.slice(1)}`;
}

function validateImagePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new TypeError('Choose an image file.');
  }
  const resolved = path.resolve(filePath.trim());
  const extension = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new TypeError('Use an image file: PNG, JPG, JPEG, WEBP, BMP, or GIF.');
  }
  return { resolved, extension };
}

async function replaceCustomImage(sourcePath, destinationDirectory, idPrefix, existingFileName) {
  const { resolved, extension } = validateImagePath(sourcePath);
  const sourceInfo = await fs.stat(resolved);
  if (!sourceInfo.isFile()) {
    throw new TypeError('The selected image is not a file.');
  }

  if (existingFileName) {
    await fs.rm(path.join(destinationDirectory, existingFileName), { force: true });
  }

  const fileName = `${idPrefix}${extension}`;
  await fs.copyFile(resolved, path.join(destinationDirectory, fileName));
  return fileName;
}

async function stateForRenderer() {
  const sites = await Promise.all(state.sites.map(async (site) => {
    let thumbnail = '';
    if (site.customThumbnail) {
      try {
        const file = await fs.readFile(customSiteImagePath(site.customThumbnail));
        thumbnail = `data:${imageMimeType(site.customThumbnail)};base64,${file.toString('base64')}`;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    if (!thumbnail) {
      try {
        thumbnail = `data:image/jpeg;base64,${(await fs.readFile(previewPath(site.id))).toString('base64')}`;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    return { ...site, thumbnail, hasCustomThumbnail: Boolean(site.customThumbnail) };
  }));

  const apps = await Promise.all(state.apps.map(async (item) => {
    let icon = APP_BRAND_ICON_DATA[item.id] ?? '';
    if (item.customIcon) {
      try {
        const file = await fs.readFile(customAppIconPath(item.customIcon));
        icon = `data:${imageMimeType(item.customIcon)};base64,${file.toString('base64')}`;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    const validated = validateAppTarget(item.target);
    if (!item.customIcon && validated.kind === 'file') {
      try {
        const systemIcon = await app.getFileIcon(validated.target, { size: 'normal' });
        if (!systemIcon.isEmpty()) {
          icon = systemIcon.toDataURL();
        }
      } catch {
        icon = '';
      }
    }

    if (!icon) {
      icon = glyphIconDataUrl(APP_ICON_GLYPHS[item.id] ?? item.title.slice(0, 1).toUpperCase());
    }
    return { ...item, icon, hasCustomIcon: Boolean(item.customIcon) };
  }));

  return {
    groups: state.groups.map((group) => ({ ...group })),
    sites,
    apps,
    settings: { ...state.settings }
  };
}

function resolveGroupId(groupId) {
  const fallbackGroupId = state.groups[0]?.id ?? DEFAULT_GROUP_ID;
  const candidate = typeof groupId === 'string' && groupId.trim().length > 0
    ? groupId.trim()
    : fallbackGroupId;
  if (!state.groups.some((group) => group.id === candidate)) {
    throw new TypeError('Choose a valid group.');
  }
  return candidate;
}

async function collectAppTargetsFromFolder(folderPath, maxResults) {
  const targets = [];
  const queue = [folderPath];
  while (queue.length > 0 && targets.length < maxResults) {
    const current = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(error.code)) {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (APP_SCAN_EXTENSIONS.has(extension)) {
        targets.push(fullPath);
        if (targets.length >= maxResults) {
          break;
        }
      }
    }
  }
  return targets;
}

function appTitleFromPath(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, ' ').trim();
  if (!base) {
    return 'App';
  }
  return base.length > 50 ? base.slice(0, 50).trimEnd() : base;
}

async function capturePreview(site) {
  const window = new BrowserWindow({
    width: 900,
    height: 580,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      event.preventDefault();
    }
  });

  let timeout;
  try {
    await Promise.race([
      window.loadURL(site.url),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The website took too long to load its preview.')), 20000);
      })
    ]);
    clearTimeout(timeout);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const image = await window.webContents.capturePage();
    const resized = image.resize({ width: 720, height: 440, quality: 'good' });
    await fs.writeFile(previewPath(site.id), resized.toJPEG(72));
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

function getSite(siteId) {
  const site = state.sites.find((entry) => entry.id === siteId);
  if (!site) {
    throw new Error('That website tile no longer exists.');
  }
  return site;
}

function getApp(appId) {
  const item = state.apps.find((entry) => entry.id === appId);
  if (!item) {
    throw new Error('That app shortcut no longer exists.');
  }
  return item;
}

function createSiteWindow(site) {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#0f1821',
    title: site.title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  siteWindows.add(window);
  window.on('closed', () => siteWindows.delete(window));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      window.close();
    }
  });
  window.loadURL(site.url);
}

function registerHandlers() {
  ipcMain.handle('launcher:get-state', stateForRenderer);
  ipcMain.handle('launcher:open-site', async (_event, siteId) => {
    const site = getSite(siteId);
    if (site.openInLauncher) {
      createSiteWindow(site);
      return;
    }
    await shell.openExternal(site.url);
  });
  ipcMain.handle('launcher:add-site', async (_event, input) => {
    const title = validateTitle(input?.title);
    const url = normalizeSiteUrl(input?.url);
    const site = {
      id: crypto.randomUUID(),
      title,
      url,
      pinned: false,
      order: state.sites.length,
      color: SITE_COLORS[state.sites.length % SITE_COLORS.length],
      customThumbnail: '',
      openInLauncher: Boolean(input?.openInLauncher),
      groupId: resolveGroupId(input?.groupId)
    };
    if (input?.thumbnailPath) {
      site.customThumbnail = await replaceCustomImage(input.thumbnailPath, siteMediaPath, site.id, site.customThumbnail);
    }
    state.sites.push(site);
    await saveState();

    let previewError = '';
    if (!site.customThumbnail) {
      try {
        await capturePreview(site);
      } catch (error) {
        previewError = error.message;
      }
    }
    return { state: await stateForRenderer(), previewError };
  });
  ipcMain.handle('launcher:update-site', async (_event, input) => {
    const site = getSite(input?.id);
    site.title = validateTitle(input?.title);
    const url = normalizeSiteUrl(input?.url);
    if (url !== site.url) {
      site.url = url;
      await fs.rm(previewPath(site.id), { force: true });
    }
    site.openInLauncher = Boolean(input?.openInLauncher);
    site.groupId = resolveGroupId(input?.groupId);
    if (input?.removeThumbnail) {
      if (site.customThumbnail) {
        await fs.rm(customSiteImagePath(site.customThumbnail), { force: true });
      }
      site.customThumbnail = '';
    }
    if (input?.thumbnailPath) {
      site.customThumbnail = await replaceCustomImage(input.thumbnailPath, siteMediaPath, site.id, site.customThumbnail);
    }
    await saveState();
    let previewError = '';
    if (!site.customThumbnail) {
      try {
        await capturePreview(site);
      } catch (error) {
        previewError = error.message;
      }
    }
    return { state: await stateForRenderer(), previewError };
  });
  ipcMain.handle('launcher:delete-site', async (_event, siteId) => {
    const site = getSite(siteId);
    state.sites = state.sites.filter((site) => site.id !== siteId);
    await fs.rm(previewPath(siteId), { force: true });
    if (site.customThumbnail) {
      await fs.rm(customSiteImagePath(site.customThumbnail), { force: true });
    }
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:toggle-pin', async (_event, siteId) => {
    const site = getSite(siteId);
    site.pinned = !site.pinned;
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:reorder-sites', async (_event, ids) => {
    const currentIds = state.sites.map((site) => site.id).sort();
    if (!Array.isArray(ids) || ids.length !== currentIds.length ||
        new Set(ids).size !== ids.length || [...ids].sort().some((id, index) => id !== currentIds[index])) {
      throw new TypeError('The website order is invalid.');
    }
    ids.forEach((id, order) => {
      getSite(id).order = order;
    });
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:capture-site', async (_event, siteId) => {
    await capturePreview(getSite(siteId));
    return stateForRenderer();
  });
  ipcMain.handle('launcher:refresh-previews', async () => {
    const failures = [];
    for (const site of state.sites) {
      try {
        await capturePreview(site);
      } catch (error) {
        failures.push({ title: site.title, message: error.message });
      }
    }
    return { state: await stateForRenderer(), failures };
  });
  ipcMain.handle('launcher:update-background', async (_event, color) => {
    state.settings.backgroundColor = validateHexColor(color, 'background color');
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:add-app', async (_event, input) => {
    const title = validateTitle(input?.title);
    const validated = validateAppTarget(input?.target);
    if (validated.kind === 'file') {
      const info = await fs.stat(validated.target);
      if (!info.isFile()) {
        throw new TypeError('The selected application is not a file.');
      }
    }
    state.apps.push({
      id: crypto.randomUUID(),
      title,
      target: validated.target,
      color: SITE_COLORS[state.apps.length % SITE_COLORS.length],
      isDefault: false,
      groupId: resolveGroupId(input?.groupId),
      customIcon: input?.iconPath
        ? await replaceCustomImage(input.iconPath, appMediaPath, crypto.randomUUID(), '')
        : ''
    });
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:delete-app', async (_event, appId) => {
    const item = getApp(appId);
    if (item.isDefault) {
      throw new Error('Built-in app shortcuts cannot be removed.');
    }
    state.apps = state.apps.filter((entry) => entry.id !== appId);
    if (item.customIcon) {
      await fs.rm(customAppIconPath(item.customIcon), { force: true });
    }
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:update-app-icon', async (_event, appId, iconPath) => {
    const item = getApp(appId);
    item.customIcon = await replaceCustomImage(iconPath, appMediaPath, item.id, item.customIcon);
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:clear-app-icon', async (_event, appId) => {
    const item = getApp(appId);
    if (item.customIcon) {
      await fs.rm(customAppIconPath(item.customIcon), { force: true });
      item.customIcon = '';
      await saveState();
    }
    return stateForRenderer();
  });
  ipcMain.handle('launcher:launch-app', async (_event, appId) => {
    const item = getApp(appId);
    const validated = validateAppTarget(item.target);
    if (validated.kind === 'file') {
      if (path.win32.extname(validated.target).toLowerCase() === '.lnk') {
        const errorMessage = await shell.openPath(validated.target);
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        return;
      }
      const child = spawn(validated.target, [], { detached: true, stdio: 'ignore', shell: false });
      child.once('error', (error) => {
        dialog.showErrorBox(`Could not launch ${item.title}`, error.message);
      });
      child.unref();
      return;
    }
    await shell.openExternal(validated.target);
  });
  ipcMain.handle('launcher:pick-app', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a local app',
      properties: ['openFile'],
      filters: [{ name: 'Windows applications', extensions: ['exe', 'lnk'] }]
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('launcher:pick-image', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('launcher:add-group', async (_event, titleInput) => {
    const title = validateTitle(titleInput);
    if (state.groups.some((group) => group.title.toLowerCase() === title.toLowerCase())) {
      throw new TypeError('That group already exists.');
    }
    state.groups.push({
      id: `group-${crypto.randomUUID()}`,
      title
    });
    await saveState();
    return stateForRenderer();
  });
  ipcMain.handle('launcher:pick-app-folders', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose folder(s) to scan for apps',
      properties: ['openDirectory', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('launcher:scan-app-folders', async (_event, folderPaths) => {
    if (!Array.isArray(folderPaths) || folderPaths.length === 0) {
      throw new TypeError('Choose at least one folder to scan.');
    }
    const normalizedFolders = [];
    for (const value of folderPaths) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }
      const resolved = path.resolve(value.trim());
      const info = await fs.stat(resolved);
      if (!info.isDirectory()) {
        throw new TypeError(`Not a folder: ${resolved}`);
      }
      normalizedFolders.push(resolved);
    }
    if (normalizedFolders.length === 0) {
      throw new TypeError('Choose at least one folder to scan.');
    }

    const uniqueTargets = new Map();
    const maxResults = 800;
    for (const folder of normalizedFolders) {
      const found = await collectAppTargetsFromFolder(folder, maxResults);
      for (const target of found) {
        const key = target.toLowerCase();
        if (!uniqueTargets.has(key)) {
          uniqueTargets.set(key, target);
        }
        if (uniqueTargets.size >= maxResults) {
          break;
        }
      }
      if (uniqueTargets.size >= maxResults) {
        break;
      }
    }

    const existingTargets = new Set(state.apps
      .map((item) => {
        const validated = validateAppTarget(item.target);
        return validated.kind === 'file' ? validated.target.toLowerCase() : '';
      })
      .filter(Boolean));

    const candidates = [...uniqueTargets.values()]
      .map((target) => ({
        target,
        title: appTitleFromPath(target),
        alreadyAdded: existingTargets.has(target.toLowerCase())
      }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
        a.target.localeCompare(b.target, undefined, { sensitivity: 'base' }));

    return { folders: normalizedFolders, candidates };
  });
  ipcMain.handle('launcher:add-scanned-apps', async (_event, input) => {
    const selections = Array.isArray(input?.selections) ? input.selections : [];
    if (selections.length === 0) {
      throw new TypeError('Choose at least one app to add.');
    }
    const groupId = resolveGroupId(input?.groupId);
    const existingTargets = new Set(state.apps
      .map((item) => {
        const validated = validateAppTarget(item.target);
        return validated.kind === 'file' ? validated.target.toLowerCase() : '';
      })
      .filter(Boolean));
    const queuedTargets = new Set();
    let added = 0;
    let skipped = 0;

    for (const selection of selections) {
      const title = validateTitle(selection?.title);
      const validated = validateAppTarget(selection?.target);
      if (validated.kind !== 'file') {
        skipped += 1;
        continue;
      }
      const key = validated.target.toLowerCase();
      if (existingTargets.has(key) || queuedTargets.has(key)) {
        skipped += 1;
        continue;
      }
      let info;
      try {
        info = await fs.stat(validated.target);
      } catch {
        skipped += 1;
        continue;
      }
      if (!info.isFile()) {
        skipped += 1;
        continue;
      }
      queuedTargets.add(key);
      state.apps.push({
        id: crypto.randomUUID(),
        title,
        target: validated.target,
        color: SITE_COLORS[state.apps.length % SITE_COLORS.length],
        isDefault: false,
        groupId,
        customIcon: ''
      });
      added += 1;
    }

    if (added > 0) {
      await saveState();
    }
    return { state: await stateForRenderer(), added, skipped };
  });
  ipcMain.handle('launcher:toggle-fullscreen', () => {
    const nextValue = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextValue);
    return nextValue;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#101821',
    title: 'Homepage Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const dataDirectory = path.join(app.getPath('userData'), 'HomepageLauncher');
  statePath = path.join(dataDirectory, 'launcher.json');
  previewsPath = path.join(dataDirectory, 'previews');
  siteMediaPath = path.join(dataDirectory, 'site-images');
  appMediaPath = path.join(dataDirectory, 'app-icons');
  await Promise.all([
    fs.mkdir(previewsPath, { recursive: true }),
    fs.mkdir(siteMediaPath, { recursive: true }),
    fs.mkdir(appMediaPath, { recursive: true })
  ]);
  await loadState();
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  dialog.showErrorBox('Homepage Launcher could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
