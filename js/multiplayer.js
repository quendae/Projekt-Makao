import { BOT_NAMES } from './constants.js';

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const SIGNAL_TIMEOUT_MS = 12000;
const MAX_MESSAGE_BYTES = 96 * 1024;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GAME_ACTIONS = new Set(['play-cards', 'draw', 'pass-after-draw', 'toggle-makao', 'choose-pending']);

export function normalizeRoomCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : '';
}

export function filterStateForSeat(state, seat) {
  const view = typeof structuredClone === 'function'
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));

  view.players = (view.players || []).map((player, index) => ({
    ...player,
    isLocal: index === seat,
    hand: index === seat
      ? player.hand
      : Array.from({ length: player.hand?.length || 0 }, () => ({ hidden: true })),
  }));
  view.drawPile = Array.from({ length: view.drawPile?.length || 0 }, () => ({ hidden: true }));

  if (view.pendingChoice?.actorIndex !== seat) view.pendingChoice = null;
  if (view.currentIndex !== seat) {
    view.drawnRescueCardId = null;
    view.makaoArmed = false;
  }

  return view;
}

export function seatReady({ seat, tableSize, botSeats, peers }) {
  if (!Number.isInteger(seat) || seat <= 0 || seat >= tableSize) return false;
  if (botSeats.has(seat)) return true;
  return Boolean(peers.get(seat)?.connected);
}

function validateNick(value) {
  const nickname = String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = Array.from(nickname).length;
  if (length < 3 || length > 20) return { ok: false, message: 'Nick powinien mieć od 3 do 20 znaków.' };
  if (/https?:|www\.|[<>@]/iu.test(nickname) || !/^[\p{L}\p{N} _-]+$/u.test(nickname)) {
    return { ok: false, message: 'Nick może zawierać litery, cyfry, spacje, _ i -.' };
  }
  return { ok: true, nickname };
}

function safeJsonParse(raw) {
  try {
    const text = typeof raw === 'string' ? raw : String(raw || '');
    if (text.length > MAX_MESSAGE_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeClose(target) {
  try {
    target?.close?.();
  } catch {
    // Already closed.
  }
}

function channelOpen(channel) {
  return channel?.readyState === 'open';
}

function randomRoomCode() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function roomVerifier(room, password = '') {
  return sha256Hex(`makao-p2p:${room}:${password}`);
}

function waitForIce(pc, timeoutMs = 6000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function signalingErrorMessage(error) {
  const message = String(error?.message || error || 'Błąd połączenia');
  if (/404|expired|not found/i.test(message)) return 'Pokój nie istnieje albo wygasł.';
  if (/403|auth|password|token/i.test(message)) return 'Nieprawidłowy kod pokoju lub hasło.';
  if (/full|4009/i.test(message)) return 'Pokój jest pełny.';
  if (/timeout|timed out/i.test(message)) return 'Przekroczono czas łączenia z usługą sygnalizacji.';
  return message;
}

export class MakaoMultiplayer {
  constructor(game) {
    this.game = game;
    this.ui = null;
    this.pendingTableSize = 3;
    this.intentionalClose = false;
    this.session = this.emptySession();
    this.el = {};
  }

  emptySession() {
    return {
      active: false,
      role: null,
      room: '',
      nick: '',
      auth: '',
      hostToken: '',
      passwordProtected: false,
      localSeat: 0,
      tableSize: this.pendingTableSize || 3,
      names: ['', '', '', ''],
      botSeats: new Set(),
      peers: new Map(),
      signalToSeat: new Map(),
      guestPc: null,
      guestChannel: null,
      signaling: null,
      inGame: false,
      revision: 0,
      lastRevision: 0,
      connectedSeats: new Set(),
    };
  }

  attachUI(ui) {
    this.ui = ui;
    this.bindElements();
    this.bindEvents();
    this.restoreName();
    this.renderEntry();
    this.updateNetworkPill();
  }

  bindElements() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      open: $('multiplayer-btn'),
      modal: $('multiplayer-modal'),
      close: $('mp-close'),
      entry: $('mp-entry'),
      hostPanel: $('mp-host-panel'),
      guestPanel: $('mp-guest-panel'),
      lobbyPanel: $('mp-lobby-panel'),
      chooseHost: $('mp-choose-host'),
      chooseGuest: $('mp-choose-guest'),
      hostBack: $('mp-host-back'),
      guestBack: $('mp-guest-back'),
      hostNick: $('mp-host-nick'),
      hostPassword: $('mp-host-password'),
      guestNick: $('mp-guest-nick'),
      guestPassword: $('mp-guest-password'),
      roomInput: $('mp-room-code'),
      create: $('mp-create-room'),
      join: $('mp-join-room'),
      hostStatus: $('mp-host-status'),
      guestStatus: $('mp-guest-status'),
      lobbyStatus: $('mp-lobby-status'),
      roomCode: $('mp-room-code-display'),
      copyRoom: $('mp-copy-room'),
      seats: $('mp-seats'),
      start: $('mp-start-game'),
      leave: $('mp-leave-room'),
      tableSize: $('mp-table-size'),
      pill: $('network-pill'),
      disconnect: $('mp-disconnect'),
      disconnectText: $('mp-disconnect-text'),
      disconnectLeave: $('mp-disconnect-leave'),
    };
  }

  bindEvents() {
    this.el.open?.addEventListener('click', () => this.openModal());
    this.el.close?.addEventListener('click', () => {
      if (this.session.active) this.leaveRoom();
      else this.closeModal();
    });
    this.el.modal?.addEventListener('click', (event) => {
      if (event.target === this.el.modal && !this.session.active) this.closeModal();
    });
    this.el.chooseHost?.addEventListener('click', () => this.showPanel('host'));
    this.el.chooseGuest?.addEventListener('click', () => this.showPanel('guest'));
    this.el.hostBack?.addEventListener('click', () => this.renderEntry());
    this.el.guestBack?.addEventListener('click', () => this.renderEntry());
    this.el.create?.addEventListener('click', () => this.createRoom());
    this.el.join?.addEventListener('click', () => this.joinRoom());
    this.el.copyRoom?.addEventListener('click', () => this.copyRoomCode());
    this.el.start?.addEventListener('click', () => this.startHostGame());
    this.el.leave?.addEventListener('click', () => this.leaveRoom());
    this.el.disconnectLeave?.addEventListener('click', () => this.leaveRoom());
    this.el.tableSize?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mp-table-size]');
      if (!button || this.session.active) return;
      this.pendingTableSize = Number(button.dataset.mpTableSize) === 4 ? 4 : 3;
      this.el.tableSize.querySelectorAll('[data-mp-table-size]').forEach((item) => item.classList.toggle('active', item === button));
    });
    this.el.seats?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mp-bot-seat]');
      if (!button) return;
      this.toggleBotSeat(Number(button.dataset.mpBotSeat));
    });
  }

  restoreName() {
    let name = '';
    try {
      name = localStorage.getItem('makao-player-name') || '';
    } catch {
      // Storage may be disabled.
    }
    if (name) {
      if (this.el.hostNick) this.el.hostNick.value = name;
      if (this.el.guestNick) this.el.guestNick.value = name;
    }
  }

  persistName(name) {
    try {
      localStorage.setItem('makao-player-name', name);
    } catch {
      // Storage may be disabled.
    }
  }

  openModal() {
    this.ui?.closeMenu?.();
    this.el.modal?.classList.add('open');
    if (this.session.active) this.renderLobby();
    else this.renderEntry();
  }

  closeModal() {
    this.el.modal?.classList.remove('open');
  }

  renderEntry() {
    this.setView('entry');
    this.setStatus('host', '');
    this.setStatus('guest', '');
  }

  showPanel(name) {
    this.setView(name);
  }

  setView(name) {
    this.el.entry?.classList.toggle('hidden', name !== 'entry');
    this.el.hostPanel?.classList.toggle('hidden', name !== 'host');
    this.el.guestPanel?.classList.toggle('hidden', name !== 'guest');
    this.el.lobbyPanel?.classList.toggle('hidden', name !== 'lobby');
  }

  setStatus(target, text, isError = false) {
    const element = target === 'host' ? this.el.hostStatus : target === 'guest' ? this.el.guestStatus : this.el.lobbyStatus;
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('error', Boolean(isError));
  }

  signalingBase() {
    const configured = document.querySelector('meta[name="makao-signaling-url"]')?.getAttribute('content')?.trim();
    if (configured) return configured.replace(/\/$/, '');
    if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return location.origin;
    }
    return '';
  }

  websocketUrl(base, room) {
    const url = new URL(`${base}/api/rooms/${encodeURIComponent(room)}/socket`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  async createRoom() {
    if (!window.RTCPeerConnection || !globalThis.crypto?.subtle) {
      this.setStatus('host', 'Ta przeglądarka nie obsługuje WebRTC/Web Crypto.', true);
      return;
    }
    const checked = validateNick(this.el.hostNick?.value);
    if (!checked.ok) return this.setStatus('host', checked.message, true);
    const password = this.el.hostPassword?.value || '';
    if (password && password.length < 6) return this.setStatus('host', 'Hasło powinno mieć co najmniej 6 znaków.', true);
    const base = this.signalingBase();
    if (!base) return this.setStatus('host', 'Multiplayer wymaga wdrożonego adresu HTTPS z usługą /api/.', true);

    this.closeNetworkResources();
    this.session = this.emptySession();
    this.session.active = true;
    this.session.role = 'host';
    this.session.tableSize = this.pendingTableSize;
    this.session.localSeat = 0;
    this.session.nick = checked.nickname;
    this.session.names[0] = checked.nickname;
    this.session.passwordProtected = Boolean(password);
    this.persistName(checked.nickname);
    this.setStatus('host', 'Tworzenie pokoju…');

    try {
      let created = null;
      for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
        const room = randomRoomCode();
        const auth = await roomVerifier(room, password);
        const response = await this.fetchWithTimeout(`${base}/api/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ room, nick: checked.nickname, auth, passwordProtected: Boolean(password) }),
        });
        if (response.status === 409) continue;
        if (!response.ok) throw new Error(`Room create failed: ${response.status}`);
        created = await response.json();
        this.session.room = created.room;
        this.session.auth = auth;
        this.session.hostToken = created.hostToken;
      }
      if (!created) throw new Error('Nie udało się wygenerować wolnego kodu pokoju.');
      await this.openSignaling('host', { token: this.session.hostToken });
      this.renderLobby();
      this.setStatus('lobby', 'Pokój gotowy. Przekaż kod pozostałym graczom.');
    } catch (error) {
      this.setStatus('host', signalingErrorMessage(error), true);
      this.closeNetworkResources();
      this.session = this.emptySession();
    }
  }

  async joinRoom() {
    if (!window.RTCPeerConnection || !globalThis.crypto?.subtle) {
      this.setStatus('guest', 'Ta przeglądarka nie obsługuje WebRTC/Web Crypto.', true);
      return;
    }
    const checked = validateNick(this.el.guestNick?.value);
    if (!checked.ok) return this.setStatus('guest', checked.message, true);
    const room = normalizeRoomCode(this.el.roomInput?.value);
    if (!room) return this.setStatus('guest', 'Wpisz pełny ośmioznakowy kod pokoju.', true);
    const password = this.el.guestPassword?.value || '';
    const base = this.signalingBase();
    if (!base) return this.setStatus('guest', 'Multiplayer wymaga wdrożonego adresu HTTPS z usługą /api/.', true);

    this.closeNetworkResources();
    this.session = this.emptySession();
    this.session.active = true;
    this.session.role = 'guest';
    this.session.localSeat = -1;
    this.session.room = room;
    this.session.nick = checked.nickname;
    this.session.auth = await roomVerifier(room, password);
    this.session.passwordProtected = Boolean(password);
    this.persistName(checked.nickname);
    this.setStatus('guest', 'Łączenie z pokojem…');

    try {
      await this.openSignaling('guest', { auth: this.session.auth, nick: checked.nickname });
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.session.guestPc = pc;
      const channel = pc.createDataChannel('makao', { ordered: true });
      this.attachGuestChannel(channel);
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.networkInterrupted(0);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIce(pc);
      this.signalSend({ type: 'offer', sdp: pc.localDescription });
      this.setView('lobby');
      this.renderLobby();
      this.setStatus('lobby', 'Pokój znaleziony. Łączenie bezpośrednie z gospodarzem…');
    } catch (error) {
      this.setStatus('guest', signalingErrorMessage(error), true);
      this.closeNetworkResources();
      this.session = this.emptySession();
    }
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Signaling timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  openSignaling(role, credentials) {
    const base = this.signalingBase();
    if (!base) return Promise.reject(new Error('Brak adresu sygnalizacji'));
    const ws = new WebSocket(this.websocketUrl(base, this.session.room));
    this.session.signaling = ws;

    return new Promise((resolve, reject) => {
      let authenticated = false;
      const timer = setTimeout(() => {
        if (!authenticated) {
          safeClose(ws);
          reject(new Error('Signaling timeout'));
        }
      }, SIGNAL_TIMEOUT_MS);

      ws.onmessage = (event) => {
        const message = safeJsonParse(event.data);
        if (!message) return;
        if (message.type === 'auth-required') {
          ws.send(JSON.stringify({ type: 'authenticate', role, ...credentials }));
          return;
        }
        if (message.type === 'authenticated') {
          authenticated = true;
          clearTimeout(timer);
          resolve(message);
          if (role === 'host') {
            for (const guest of message.guests || []) {
              if (guest.offer) queueMicrotask(() => this.handleHostOffer({ type: 'offer', guestId: guest.id, nick: guest.nick, sdp: guest.offer }));
            }
          }
          return;
        }
        this.handleSignalMessage(message);
      };

      ws.onerror = () => {
        if (!authenticated) {
          clearTimeout(timer);
          reject(new Error('Nie udało się połączyć z sygnalizacją.'));
        }
      };

      ws.onclose = (event) => {
        clearTimeout(timer);
        if (!authenticated) {
          reject(new Error(event.reason || `Signaling closed (${event.code})`));
          return;
        }
        if (!this.intentionalClose && !this.session.inGame && this.session.active) {
          this.setStatus('lobby', event.reason || 'Połączenie z sygnalizacją zostało zamknięte.', true);
        }
      };
    });
  }

  signalSend(message) {
    const ws = this.session.signaling;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  handleSignalMessage(message) {
    if (this.session.role === 'host') {
      if (message.type === 'offer') this.handleHostOffer(message);
      if (message.type === 'guest-left') this.removeLobbyGuest(message.guestId);
      return;
    }

    if (this.session.role === 'guest') {
      if (message.type === 'answer') this.acceptAnswer(message);
      if (message.type === 'rejected') {
        this.setStatus('lobby', message.reason || 'Gospodarz odrzucił połączenie.', true);
        safeClose(this.session.guestPc);
      }
      if (message.type === 'room-closed' && !this.session.inGame) {
        this.setStatus('lobby', message.reason || 'Pokój został zamknięty.', true);
      }
    }
  }

  async handleHostOffer(offer) {
    if (this.session.role !== 'host' || this.session.inGame || !offer?.guestId || !offer?.sdp) return;
    const checked = validateNick(offer.nick);
    if (!checked.ok || this.session.signalToSeat.has(offer.guestId)) return;

    const seat = Array.from({ length: this.session.tableSize - 1 }, (_, index) => index + 1)
      .find((candidate) => !this.session.botSeats.has(candidate) && !this.session.peers.get(candidate)?.connected && !this.session.peers.get(candidate)?.pending);

    if (!seat) {
      this.signalSend({ type: 'reject', guestId: offer.guestId, reason: 'Brak wolnego miejsca przy tym stole.' });
      return;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peer = { pc, channel: null, connected: false, pending: true, guestId: offer.guestId, nick: checked.nickname };
    this.session.peers.set(seat, peer);
    this.session.signalToSeat.set(offer.guestId, seat);
    this.session.names[seat] = checked.nickname;
    pc.ondatachannel = (event) => this.attachHostChannel(seat, event.channel);
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.networkInterrupted(seat);
    };
    this.renderLobby();

    try {
      await pc.setRemoteDescription(offer.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIce(pc);
      peer.pending = false;
      this.signalSend({ type: 'answer', guestId: offer.guestId, seat, sdp: pc.localDescription });
      this.setStatus('lobby', `Łączenie z graczem ${checked.nickname}…`);
    } catch {
      this.session.signalToSeat.delete(offer.guestId);
      this.session.peers.delete(seat);
      this.session.names[seat] = '';
      safeClose(pc);
      this.signalSend({ type: 'reject', guestId: offer.guestId, reason: 'Nie udało się zestawić połączenia WebRTC.' });
      this.renderLobby();
    }
  }

  async acceptAnswer(message) {
    if (this.session.role !== 'guest' || !this.session.guestPc || !message?.sdp) return;
    this.session.localSeat = Number(message.seat);
    this.game.setLocalSeat(this.session.localSeat);
    try {
      await this.session.guestPc.setRemoteDescription(message.sdp);
    } catch (error) {
      this.setStatus('lobby', `Nie udało się przyjąć odpowiedzi gospodarza: ${error.message}`, true);
    }
  }

  attachGuestChannel(channel) {
    this.session.guestChannel = channel;
    channel.onopen = () => {
      this.sendGuest({ type: 'hello', name: this.session.nick });
      this.signalSend({ type: 'connected' });
      this.setStatus('lobby', 'Połączono P2P. Czekaj na start gospodarza.');
      this.updateNetworkPill();
    };
    channel.onmessage = (event) => {
      const message = safeJsonParse(event.data);
      if (message) this.handleHostData(message);
    };
    channel.onclose = () => this.networkInterrupted(0);
    channel.onerror = () => this.networkInterrupted(0);
  }

  attachHostChannel(seat, channel) {
    const peer = this.session.peers.get(seat);
    if (!peer) return;
    peer.channel = channel;
    channel.onopen = () => {
      peer.connected = true;
      peer.pending = false;
      this.session.connectedSeats.add(seat);
      this.sendPeer(seat, this.welcomePacket(seat));
      this.sendLobby();
      this.renderLobby();
      this.setStatus('lobby', `${peer.nick} jest połączony.`);
      this.updateNetworkPill();
    };
    channel.onmessage = (event) => {
      const message = safeJsonParse(event.data);
      if (message) this.handlePeerData(seat, message);
    };
    channel.onclose = () => this.networkInterrupted(seat);
    channel.onerror = () => this.networkInterrupted(seat);
  }

  handlePeerData(seat, message) {
    if (message.type === 'hello') {
      const checked = validateNick(message.name);
      if (checked.ok && !this.session.inGame) {
        this.session.names[seat] = checked.nickname;
        const peer = this.session.peers.get(seat);
        if (peer) peer.nick = checked.nickname;
        this.sendLobby();
        this.renderLobby();
      }
      return;
    }

    if (message.type !== 'action' || !this.session.inGame || !GAME_ACTIONS.has(message.action)) return;
    const result = this.game.executePlayerAction(seat, message.action, message.payload || {});
    if (!result?.ok) {
      this.sendPeer(seat, { type: 'error', code: 'ILLEGAL_ACTION', message: result?.reason || 'Niedozwolona akcja.' });
    }
  }

  handleHostData(message) {
    if (message.type === 'welcome') {
      this.session.localSeat = Number(message.seat);
      this.session.tableSize = Number(message.tableSize) || 3;
      this.session.names = [...(message.names || [])];
      this.session.botSeats = new Set(message.botSeats || []);
      this.session.connectedSeats = new Set(message.connectedSeats || []);
      this.game.setLocalSeat(this.session.localSeat);
      this.renderLobby();
      return;
    }

    if (message.type === 'lobby') {
      this.session.tableSize = Number(message.tableSize) || this.session.tableSize;
      this.session.names = [...(message.names || this.session.names)];
      this.session.botSeats = new Set(message.botSeats || []);
      this.session.connectedSeats = new Set(message.connectedSeats || []);
      this.renderLobby();
      return;
    }

    if (message.type === 'start') {
      this.session.inGame = true;
      this.closeModal();
      this.setStatus('lobby', 'Gra rozpoczęta.');
      this.updateNetworkPill();
      return;
    }

    if (message.type === 'state') {
      const revision = Number(message.revision) || 0;
      if (revision <= this.session.lastRevision || !message.state) return;
      this.session.lastRevision = revision;
      this.session.inGame = true;
      this.game.applyRemoteState(message.state, this.session.localSeat);
      this.closeModal();
      this.updateNetworkPill();
      if (message.state.networkPaused) this.showDisconnect('Rozgrywka została wstrzymana, ponieważ jeden z graczy utracił połączenie.');
      return;
    }

    if (message.type === 'error') this.ui?.showToast?.(message.message || 'Gospodarz odrzucił akcję.');
  }

  welcomePacket(seat) {
    return {
      type: 'welcome',
      seat,
      tableSize: this.session.tableSize,
      names: this.session.names.slice(0, this.session.tableSize),
      botSeats: [...this.session.botSeats],
      connectedSeats: this.connectedHumanSeats(),
    };
  }

  sendLobby() {
    if (this.session.role !== 'host') return;
    const packet = {
      type: 'lobby',
      tableSize: this.session.tableSize,
      names: this.session.names.slice(0, this.session.tableSize),
      botSeats: [...this.session.botSeats],
      connectedSeats: this.connectedHumanSeats(),
    };
    this.broadcast(packet);
  }

  connectedHumanSeats() {
    const seats = [0];
    for (let seat = 1; seat < this.session.tableSize; seat += 1) {
      if (this.session.peers.get(seat)?.connected) seats.push(seat);
    }
    return seats;
  }

  sendPeer(seat, message) {
    const channel = this.session.peers.get(seat)?.channel;
    if (channelOpen(channel)) channel.send(JSON.stringify(message));
  }

  sendGuest(message) {
    if (channelOpen(this.session.guestChannel)) this.session.guestChannel.send(JSON.stringify(message));
  }

  broadcast(message) {
    if (this.session.role !== 'host') return;
    for (let seat = 1; seat < this.session.tableSize; seat += 1) this.sendPeer(seat, message);
  }

  handleGameStateChange(state) {
    if (this.session.role !== 'host' || !this.session.inGame || !state?.started) return;
    this.session.revision += 1;
    for (let seat = 1; seat < this.session.tableSize; seat += 1) {
      const peer = this.session.peers.get(seat);
      if (!peer?.connected) continue;
      this.sendPeer(seat, {
        type: 'state',
        revision: this.session.revision,
        state: filterStateForSeat(state, seat),
      });
    }
  }

  handleGameAction(action, payload = {}) {
    if (!this.session.inGame) return { ok: false, reason: 'Multiplayer nie jest aktywny.' };
    if (!GAME_ACTIONS.has(action)) return { ok: false, reason: 'Nieznana akcja.' };

    if (this.session.role === 'host') {
      const result = this.game.executePlayerAction(this.session.localSeat, action, payload);
      if (!result?.ok) this.ui?.showToast?.(result?.reason || 'Niedozwolona akcja.');
      return result;
    }

    if (this.session.role === 'guest') {
      if (!channelOpen(this.session.guestChannel)) {
        const result = { ok: false, reason: 'Brak połączenia z gospodarzem.' };
        this.ui?.showToast?.(result.reason);
        return result;
      }
      this.sendGuest({ type: 'action', action, payload });
      return { ok: true, pending: true };
    }

    return { ok: false, reason: 'Nieprawidłowa rola multiplayer.' };
  }

  isGameActive() {
    return Boolean(this.session.active && this.session.inGame);
  }

  isGuest() {
    return this.session.role === 'guest';
  }

  toggleBotSeat(seat) {
    if (this.session.role !== 'host' || this.session.inGame || !Number.isInteger(seat) || seat <= 0 || seat >= this.session.tableSize) return;
    const peer = this.session.peers.get(seat);
    if (peer?.connected || peer?.pending) return;

    if (this.session.botSeats.has(seat)) {
      this.session.botSeats.delete(seat);
      this.session.names[seat] = '';
    } else {
      this.session.botSeats.add(seat);
      this.session.names[seat] = BOT_NAMES[(seat - 1) % BOT_NAMES.length] || `Bot ${seat}`;
    }
    this.renderLobby();
    this.sendLobby();
  }

  allSeatsReady() {
    if (this.session.role !== 'host') return false;
    for (let seat = 1; seat < this.session.tableSize; seat += 1) {
      if (!seatReady({ seat, tableSize: this.session.tableSize, botSeats: this.session.botSeats, peers: this.session.peers })) return false;
    }
    return true;
  }

  startHostGame() {
    if (this.session.role !== 'host' || this.session.inGame || !this.allSeatsReady()) return;
    const seats = Array.from({ length: this.session.tableSize }, (_, index) => ({
      id: `seat-${index}`,
      name: this.session.names[index] || (this.session.botSeats.has(index) ? `Bot ${index}` : `Gracz ${index + 1}`),
      isBot: this.session.botSeats.has(index),
    }));
    seats[0].isBot = false;

    this.session.inGame = true;
    this.session.revision = 0;
    this.broadcast({ type: 'start' });
    this.closeModal();
    this.game.startMultiplayer(seats, { localSeat: 0 });
    this.signalSend({ type: 'close-room' });
    this.updateNetworkPill();
  }

  renderLobby() {
    if (!this.session.active) return;
    this.setView('lobby');
    if (this.el.roomCode) this.el.roomCode.textContent = this.session.room || '—';
    if (!this.el.seats) return;

    const tableSize = this.session.tableSize || 3;
    const rows = [];
    for (let seat = 0; seat < tableSize; seat += 1) {
      const isBot = this.session.botSeats.has(seat);
      const peer = this.session.peers.get(seat);
      const isLocal = seat === this.session.localSeat;
      const connected = seat === 0 || Boolean(peer?.connected) || (this.session.role === 'guest' && this.session.connectedSeats.has(seat));
      const pending = Boolean(peer?.pending);
      const name = this.session.names[seat] || (seat === 0 ? 'Gospodarz' : 'Wolne miejsce');
      const status = isBot ? 'BOT · GOTOWY' : connected ? 'POŁĄCZONY' : pending ? 'ŁĄCZENIE…' : 'OCZEKUJE';
      const botButton = this.session.role === 'host' && seat > 0 && !connected && !pending
        ? `<button type="button" class="mp-seat-action" data-mp-bot-seat="${seat}">${isBot ? 'Usuń bota' : 'Dodaj bota'}</button>`
        : '';
      rows.push(`<div class="mp-seat ${isLocal ? 'local' : ''} ${isBot ? 'bot' : ''}"><div class="mp-seat-index">${seat + 1}</div><div class="mp-seat-copy"><strong>${this.escapeHtml(name)}${isLocal ? ' · Ty' : ''}</strong><span>${status}</span></div>${botButton}</div>`);
    }
    this.el.seats.innerHTML = rows.join('');
    if (this.el.start) {
      this.el.start.classList.toggle('hidden', this.session.role !== 'host');
      this.el.start.disabled = !this.allSeatsReady();
    }
    this.updateNetworkPill();
  }

  escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  async copyRoomCode() {
    if (!this.session.room) return;
    try {
      await navigator.clipboard.writeText(this.session.room.replace('-', ''));
      this.ui?.showToast?.('Kod pokoju skopiowany.');
    } catch {
      this.ui?.showToast?.(`Kod pokoju: ${this.session.room}`);
    }
  }

  removeLobbyGuest(guestId) {
    const seat = this.session.signalToSeat.get(guestId);
    if (!Number.isInteger(seat)) return;
    const peer = this.session.peers.get(seat);
    safeClose(peer?.channel);
    safeClose(peer?.pc);
    this.session.signalToSeat.delete(guestId);
    this.session.peers.delete(seat);
    this.session.connectedSeats.delete(seat);
    if (!this.session.botSeats.has(seat)) this.session.names[seat] = '';
    this.renderLobby();
    this.sendLobby();
  }

  networkInterrupted(seat) {
    if (this.intentionalClose || !this.session.active) return;
    if (this.session.role === 'host' && seat > 0 && !this.session.inGame) {
      const peer = this.session.peers.get(seat);
      if (peer?.guestId) this.removeLobbyGuest(peer.guestId);
      return;
    }

    if (this.session.inGame) {
      if (this.session.role === 'host' && !this.game.state.networkPaused) {
        this.game.state.networkPaused = true;
        this.game.addLog('Rozgrywka została wstrzymana: gracz utracił połączenie.');
        this.game.emit();
      } else if (this.session.role === 'guest' && this.game.state?.started) {
        this.game.state.networkPaused = true;
        this.game.emit();
      }
      this.showDisconnect(this.session.role === 'guest'
        ? 'Połączenie z gospodarzem zostało przerwane. Rozgrywka nie będzie kontynuowana z niespójnym stanem.'
        : 'Jeden z graczy utracił połączenie. Rozgrywka została wstrzymana, aby zachować spójny stan.');
    }
    this.updateNetworkPill();
  }

  showDisconnect(message) {
    if (this.el.disconnectText) this.el.disconnectText.textContent = message;
    this.el.disconnect?.classList.add('open');
  }

  hideDisconnect() {
    this.el.disconnect?.classList.remove('open');
  }

  leaveRoom() {
    if (this.session.role === 'host' && !this.session.inGame) this.signalSend({ type: 'close-room' });
    if (this.session.role === 'guest' && !this.session.inGame) this.signalSend({ type: 'leave' });
    this.closeNetworkResources();
    this.session = this.emptySession();
    this.game.stop();
    this.hideDisconnect();
    this.closeModal();
    this.ui?.openMenu?.();
    this.updateNetworkPill();
  }

  closeNetworkResources() {
    this.intentionalClose = true;
    for (const peer of this.session.peers?.values?.() || []) {
      safeClose(peer.channel);
      safeClose(peer.pc);
    }
    safeClose(this.session.guestChannel);
    safeClose(this.session.guestPc);
    safeClose(this.session.signaling);
    this.intentionalClose = false;
  }

  updateNetworkPill() {
    if (!this.el.pill) return;
    if (!this.session.active) {
      this.el.pill.textContent = 'OFFLINE';
      this.el.pill.classList.remove('online', 'warning');
      return;
    }
    if (this.game.state?.networkPaused) {
      this.el.pill.textContent = 'P2P · WSTRZYMANO';
      this.el.pill.classList.remove('online');
      this.el.pill.classList.add('warning');
      return;
    }
    if (this.session.inGame) {
      this.el.pill.textContent = `P2P · ${this.session.role === 'host' ? 'HOST' : `MIEJSCE ${this.session.localSeat + 1}`}`;
      this.el.pill.classList.add('online');
      this.el.pill.classList.remove('warning');
      return;
    }
    this.el.pill.textContent = 'P2P · LOBBY';
    this.el.pill.classList.add('online');
    this.el.pill.classList.remove('warning');
  }

  debug() {
    return {
      active: this.session.active,
      role: this.session.role,
      room: this.session.room,
      localSeat: this.session.localSeat,
      tableSize: this.session.tableSize,
      botSeats: [...this.session.botSeats],
      connectedSeats: this.connectedHumanSeats(),
      inGame: this.session.inGame,
      revision: this.session.revision,
      lastRevision: this.session.lastRevision,
    };
  }

  debugSetBotSeat(seat, enabled = true) {
    if (this.session.role !== 'host') return false;
    if (enabled && !this.session.botSeats.has(seat)) this.toggleBotSeat(seat);
    if (!enabled && this.session.botSeats.has(seat)) this.toggleBotSeat(seat);
    return this.session.botSeats.has(seat) === enabled;
  }

  debugHostLobby({ tableSize = 4, botSeats = [2, 3], connectedSeats = [1] } = {}) {
    this.closeNetworkResources();
    this.session = this.emptySession();
    this.session.active = true;
    this.session.role = 'host';
    this.session.localSeat = 0;
    this.session.room = 'TEST-ROOM';
    this.session.nick = 'Host';
    this.session.tableSize = tableSize === 3 ? 3 : 4;
    this.session.names[0] = 'Host';
    this.session.botSeats = new Set(botSeats.filter((seat) => seat > 0 && seat < this.session.tableSize));
    for (const seat of connectedSeats) {
      if (seat <= 0 || seat >= this.session.tableSize || this.session.botSeats.has(seat)) continue;
      this.session.names[seat] = `Guest ${seat}`;
      this.session.peers.set(seat, { connected: true, pending: false, pc: null, channel: null, guestId: `debug-${seat}` });
    }
    this.openModal();
    this.renderLobby();
    return this.debug();
  }
}
