// The HUD: every DOM element the game talks to.
import { WEAPONS, GRENADES, ARMOR } from './weapons.js';

const $ = (id) => document.getElementById(id);

export const BUY_ITEMS = [
  { item: 'magpie', key: '1', code: 'Digit1' },
  { item: 'boar', key: '2', code: 'Digit2' },
  { item: 'krait', key: '3', code: 'Digit3' },
  { item: 'jackdaw', key: '4', code: 'Digit4' },
  { item: 'harrier', key: '5', code: 'Digit5' },
  { item: 'heron', key: '6', code: 'Digit6' },
  { item: 'oxen', key: '7', code: 'Digit7' },
  { item: 'lance', key: '8', code: 'Digit8' },
  { item: 'armor1', key: '9', code: 'Digit9' },
  { item: 'armor2', key: '0', code: 'Digit0' },
  { item: 'he', key: '-', code: 'Minus' },
  { item: 'flash', key: '=', code: 'Equal' },
];

export function itemInfo(item) {
  if (WEAPONS[item]) return { name: WEAPONS[item].name, price: WEAPONS[item].price, blurb: WEAPONS[item].blurb };
  if (GRENADES[item]) return { name: GRENADES[item].name, price: GRENADES[item].price, blurb: GRENADES[item].blurb };
  const tier = item === 'armor1' ? 1 : 2;
  return { name: ARMOR[tier].name, price: ARMOR[tier].price, blurb: ARMOR[tier].blurb };
}

export function createHud() {
  const els = {
    hud: $('hud'), healthFill: $('health-fill'), healthNum: $('health-num'), armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoName: $('ammo-name'), ammo: $('ammo'),
    money: $('money'), timer: $('timer'), score0: $('score-0'), score1: $('score-1'), roundLabel: $('round-label'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    callout: $('callout'), calloutTitle: $('callout-title'), calloutSub: $('callout-sub'),
    prompt: $('prompt'), channelWrap: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    bombStatus: $('bomb-status'), damage: $('damage-flash'), blind: $('blind-flash'), hitdir: $('hit-dir'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), scope: $('scope'), scopeZoom: $('scope-zoom'), spectate: $('spectate'),
    menu: $('menu'), buy: $('buy'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyNote: $('buy-note'),
    pause: $('pause'), over: $('matchover'), overTitle: $('over-title'), overSub: $('over-sub'),
    board: $('scoreboard'), boardWrap: $('board-wrap'), carrierTag: $('carrier-tag'),
    label0: $('label-0'), label1: $('label-1'), loadout: $('loadout'), rangeInfo: $('range-info'),
  };
  let bannerTimer = 0;
  let calloutTimer = 0;

  const hud = {
    els,
    onPlay: null, onBuy: null, onResume: null, onRestart: null, onPickGun: null, onMenu: null,

    setHealth(hp, armorTier) {
      els.healthFill.style.width = Math.max(0, hp) + '%';
      els.healthFill.style.background = hp > 35 ? 'var(--ink)' : 'var(--accent)';
      els.healthNum.textContent = Math.max(0, Math.ceil(hp));
      els.armorNum.textContent = armorTier > 0 ? (armorTier === 2 ? 'VEST+HELM' : 'VEST') : '';
    },
    setAmmo(mag, reserve, name) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = '/ ' + reserve;
      els.ammoName.textContent = name;
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(n) { els.money.textContent = '$' + n.toLocaleString('en-US'); },
    setTimer(text, urgent) {
      els.timer.textContent = text;
      els.timer.classList.toggle('urgent', !!urgent);
    },
    setScores(s0, s1, roundText) {
      els.score0.textContent = s0;
      els.score1.textContent = s1;
      els.roundLabel.textContent = roundText;
    },
    setLabels(a, b) {
      if (els.label0.textContent !== a) els.label0.textContent = a;
      if (els.label1.textContent !== b) els.label1.textContent = b;
    },
    showMoney(on) { els.money.style.display = on ? '' : 'none'; },
    setRange(text) {
      if (text) { els.rangeInfo.textContent = text; els.rangeInfo.classList.add('show'); }
      else els.rangeInfo.classList.remove('show');
    },
    buildLoadout(items) {
      els.loadout.innerHTML = '';
      for (const { id, key } of items) {
        const btn = document.createElement('button');
        btn.className = 'load-item';
        btn.dataset.id = id;
        btn.innerHTML = `<span class="buy-key">${key}</span>${WEAPONS[id].name}`;
        btn.addEventListener('click', () => { if (hud.onPickGun) hud.onPickGun(id); });
        els.loadout.appendChild(btn);
      }
    },
    showLoadout(selId) {
      els.loadout.classList.add('show');
      for (const btn of els.loadout.children) btn.classList.toggle('sel', btn.dataset.id === selId);
    },
    hideLoadout() { els.loadout.classList.remove('show'); },
    setSpread(px) { els.crosshair.style.setProperty('--gap', px.toFixed(0) + 'px'); },
    hitmarker(kill) {
      els.hitmarker.classList.toggle('kill', !!kill);
      els.hitmarker.classList.add('on');
      clearTimeout(hud._hmT);
      hud._hmT = setTimeout(() => els.hitmarker.classList.remove('on'), kill ? 220 : 110);
    },
    addKill(html) {
      const div = document.createElement('div');
      div.className = 'kill';
      div.innerHTML = html;
      els.killfeed.prepend(div);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 400); }, 4200);
    },
    clearKillfeed() { els.killfeed.innerHTML = ''; },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('show'), ms);
    },
    callout(title, hot, sub) {
      els.calloutTitle.textContent = title;
      els.calloutSub.textContent = sub || '';
      els.callout.classList.toggle('hot', !!hot);
      els.callout.classList.remove('show');
      void els.callout.offsetWidth;
      els.callout.classList.add('show');
      clearTimeout(calloutTimer);
      calloutTimer = setTimeout(() => els.callout.classList.remove('show'), 1650);
    },
    prompt(text) {
      if (text) { els.prompt.textContent = text; els.prompt.classList.add('show'); }
      else els.prompt.classList.remove('show');
    },
    channel(frac, label) {
      if (frac === null) { els.channelWrap.classList.remove('show'); return; }
      els.channelWrap.classList.add('show');
      els.channelFill.style.width = (frac * 100).toFixed(0) + '%';
      els.channelLabel.textContent = label;
    },
    setBomb(site) {
      if (site) { els.bombStatus.textContent = 'CHARGE PLANTED — SITE ' + site; els.bombStatus.classList.add('show'); }
      else els.bombStatus.classList.remove('show');
    },
    setCarrier(has) { els.carrierTag.classList.toggle('show', !!has); },
    damageFlash() {
      els.damage.classList.add('on');
      clearTimeout(hud._dmgT);
      hud._dmgT = setTimeout(() => els.damage.classList.remove('on'), 130);
    },
    setBlind(frac) { els.blind.style.opacity = Math.max(0, Math.min(1, frac)).toFixed(2); },
    setHitDir(angleRad) {
      if (angleRad === null) { els.hitdir.classList.remove('show'); return; }
      els.hitdir.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      els.hitdir.classList.add('show');
      clearTimeout(hud._hdT);
      hud._hdT = setTimeout(() => els.hitdir.classList.remove('show'), 700);
    },
    setScope(on, optic, label) {
      els.scope.classList.toggle('show', !!on);
      els.scope.classList.toggle('dot', optic === 'dot');
      els.scopeZoom.textContent = label || '';
      els.crosshair.style.opacity = on ? '0' : '';
    },
    setSpectate(text) {
      if (text) { els.spectate.textContent = text; els.spectate.classList.add('show'); }
      else els.spectate.classList.remove('show');
    },

    showMenu() { els.menu.classList.add('show'); },
    hideMenu() { els.menu.classList.remove('show'); },
    showPause() { els.pause.classList.add('show'); },
    hidePause() { els.pause.classList.remove('show'); },
    showOver(title, sub) {
      els.overTitle.textContent = title;
      els.overSub.textContent = sub;
      els.over.classList.add('show');
    },
    hideOver() { els.over.classList.remove('show'); },

    buildBuy() {
      els.buyGrid.innerHTML = '';
      for (const { item, key } of BUY_ITEMS) {
        const info = itemInfo(item);
        const btn = document.createElement('button');
        btn.className = 'buy-item';
        btn.dataset.item = item;
        btn.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${info.name}</span>` +
          `<span class="buy-blurb">${info.blurb}</span><span class="buy-price">$${info.price}</span>`;
        btn.addEventListener('click', () => { if (hud.onBuy) hud.onBuy(item); });
        els.buyGrid.appendChild(btn);
      }
    },
    refreshBuy(actor, canBuyNow) {
      els.buyMoney.textContent = '$' + actor.money.toLocaleString('en-US');
      els.buyNote.textContent = canBuyNow ? 'Click an item or press its key. B or Esc to close.' : 'Buy window closed — items unlock at the next freeze.';
      for (const btn of els.buyGrid.children) {
        const item = btn.dataset.item;
        const info = itemInfo(item);
        let owned = false;
        const lo = actor.loadout;
        if (WEAPONS[item]) owned = (lo[WEAPONS[item].slot] || {}).id === item;
        else if (GRENADES[item]) owned = lo[item] >= 1;
        else owned = lo.armor >= (item === 'armor1' ? 1 : 2);
        btn.classList.toggle('owned', !!owned);
        btn.classList.toggle('poor', !owned && actor.money < info.price);
        btn.classList.toggle('closed', !canBuyNow);
      }
    },
    showBuy() { els.buy.classList.add('show'); },
    hideBuy() { els.buy.classList.remove('show'); },
    buyOpen() { return els.buy.classList.contains('show'); },

    renderBoard(actors, player) {
      const rows = (team) => actors.filter((a) => a.team === team)
        .sort((x, y) => y.kills - x.kills)
        .map((a) => `<tr class="${a === player ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td>${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`)
        .join('');
      els.boardWrap.innerHTML =
        `<div class="board-team t0"><h3>JACKALS</h3><table>${rows(0)}</table></div>` +
        `<div class="board-team t1"><h3>WARDENS</h3><table>${rows(1)}</table></div>`;
    },
    showBoard() { els.board.classList.add('show'); },
    hideBoard() { els.board.classList.remove('show'); },
  };

  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.addEventListener('click', () => { if (hud.onPlay) hud.onPlay(btn.dataset.mode); });
  }
  $('resume').addEventListener('click', () => { if (hud.onResume) hud.onResume(); });
  $('restart').addEventListener('click', () => { if (hud.onRestart) hud.onRestart(); });
  $('again').addEventListener('click', () => { if (hud.onRestart) hud.onRestart(); });
  $('tomenu').addEventListener('click', () => { if (hud.onMenu) hud.onMenu(); });
  $('pausemenu').addEventListener('click', () => { if (hud.onMenu) hud.onMenu(); });
  hud.buildBuy();
  return hud;
}
