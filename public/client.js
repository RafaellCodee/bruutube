/* BruTube — Application Logic, Custom HTML5 Player & Persistence */

(() => {
  "use strict";

  const STORAGE_KEY = "brutube_state_v1";

  const defaultState = {
    customVideos: [],     // user-added MP4/URL/YouTube videos
    savedVideos: {},      // dictionary of videoId -> video metadata for history/liked/playlists
    history: [],          // array of video IDs (most recent first)
    liked: [],            // array of video IDs
    disliked: [],         // array of video IDs
    watchLater: [],       // array of video IDs
    subscriptions: [],    // array of channel names
    channelAvatars: {},   // channelName -> avatar URL cache
    profile: {
      name: "Pengguna BruTube",
      handle: "@brutube_user",
      avatarUrl: ""
    },
    playlists: [
      { id: "pl-favorit", name: "Favorit Saya", videoIds: [] }
    ],
    comments: {},
    settings: {
      focusMode: false,
      ambientMode: true,
      autoplay: true,
      ytApiKey: ""
    }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      return {
        ...structuredClone(defaultState),
        ...parsed,
        savedVideos: parsed.savedVideos || {},
        channelAvatars: parsed.channelAvatars || {},
        profile: { ...defaultState.profile, ...(parsed.profile || {}) },
        settings: { ...defaultState.settings, ...(parsed.settings || {}) },
        comments: parsed.comments || {}
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    try {
      const persistable = {
        ...state,
        customVideos: state.customVideos.filter((v) => v.type !== "local")
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      // Ignore storage quota / blocked errors gracefully
    }
  }

  let state = loadState();
  let liveFeedVideos = [];
  let liveSearchVideos = [];
  let liveRelatedVideos = [];
  let isLoadingFeed = false;
  let feedRequestToken = 0;

  let activeView = "home";
  let activeCategory = "Semua";
  let searchQuery = "";
  let currentVideo = null;
  let hideControlsTimer = null;
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const feedView = $("feedView");
  const channelView = $("channelView");
  const watchView = $("watchView");
  let activeChannelProfile = null;
  let activeChannelTab = "latest";
  const categoryBar = $("categoryBar");
  const feedHeader = $("feedHeader");
  const feedTitle = $("feedTitle");
  const feedSubtitle = $("feedSubtitle");
  const feedActions = $("feedActions");
  const videoGrid = $("videoGrid");
  const emptyState = $("emptyState");
  const emptyStateTitle = $("emptyStateTitle");
  const emptyStateDesc = $("emptyStateDesc");

  const searchForm = $("searchForm");
  const searchInput = $("searchInput");
  const clearSearchBtn = $("clearSearchBtn");
  const sidebarBackdrop = $("sidebarBackdrop");
  const menuToggleBtn = $("menuToggleBtn");

  // Watch DOM
  const playerContainer = $("playerContainer");
  const html5Video = $("html5Video");
  const ytPlayerHost = $("ytPlayerHost");
  const bgAudioOverlay = $("bgAudioOverlay");
  const bgAudioBtn = $("bgAudioBtn");
  const customControls = $("customControls");

  // YouTube IFrame API & Background Playback state
  let ytPlayer = null;
  let ytApiReady = Boolean(window.YT && window.YT.Player);
  let pendingYouTubeId = null;
  let isBgAudioMode = false;
  let wasPlayingBeforeHide = false;
  const playPauseBtn = $("playPauseBtn");
  const skipBackBtn = $("skipBackBtn");
  const skipFwdBtn = $("skipFwdBtn");
  const muteBtn = $("muteBtn");
  const volumeSlider = $("volumeSlider");
  const timeDisplay = $("timeDisplay");
  const speedSelect = $("speedSelect");
  const loopBtn = $("loopBtn");
  const pipBtn = $("pipBtn");
  const theaterBtn = $("theaterBtn");
  const theaterBarBtn = $("theaterBarBtn");
  const fullscreenBtn = $("fullscreenBtn");
  const progressWrap = $("progressWrap");
  const progressBuffered = $("progressBuffered");
  const progressPlayed = $("progressPlayed");
  const progressThumb = $("progressThumb");
  const progressTooltip = $("progressTooltip");

  const watchTitle = $("watchTitle");
  const watchSourceBadge = $("watchSourceBadge");
  const watchChannelAvatar = $("watchChannelAvatar");
  const watchChannelName = $("watchChannelName");
  const watchChannelSubs = $("watchChannelSubs");
  const subscribeBtn = $("subscribeBtn");
  const likeBtn = $("likeBtn");
  const likeCountText = $("likeCountText");
  const dislikeBtn = $("dislikeBtn");
  const watchLaterBtn = $("watchLaterBtn");
  const savePlaylistBtn = $("savePlaylistBtn");
  const shareBtn = $("shareBtn");
  const watchStats = $("watchStats");
  const watchDescription = $("watchDescription");
  const commentsCountHeading = $("commentsCountHeading");
  const commentForm = $("commentForm");
  const commentInput = $("commentInput");
  const commentsList = $("commentsList");
  const relatedVideosList = $("relatedVideosList");
  const autoplayCheckbox = $("autoplayCheckbox");

  // Modals
  const addVideoDialog = $("addVideoDialog");
  const settingsDialog = $("settingsDialog");
  const playlistDialog = $("playlistDialog");
  const shortcutsDialog = $("shortcutsDialog");

  // =========================================================================
  // Video Registry & Utilities
  // =========================================================================
  function rememberVideo(video) {
    if (!video || !video.id || video.type === "local") return;
    state.savedVideos[video.id] = video;
    if (video.channel && video.channelAvatar) {
      state.channelAvatars[video.channel] = video.channelAvatar;
    }
  }

  function renderAvatarInner(avatarUrl, name) {
    const initial = escapeHtml((name || "Y").charAt(0).toUpperCase());
    if (avatarUrl) {
      return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name || "")}" loading="lazy" onerror="this.remove()">`;
    }
    return initial;
  }

  function verifiedBadgeHtml(verified) {
    return verified ? `<span class="verified-badge" title="Channel Terverifikasi" aria-label="Terverifikasi">✓</span>` : "";
  }

  function getAllKnownVideos() {
    const map = new Map();
    [
      ...state.customVideos,
      ...liveFeedVideos,
      ...liveSearchVideos,
      ...liveRelatedVideos,
      ...Object.values(state.savedVideos)
    ].forEach((v) => {
      if (v && v.id && !map.has(v.id)) map.set(v.id, v);
    });
    return Array.from(map.values());
  }

  function findVideoById(id) {
    if (state.savedVideos[id]) return state.savedVideos[id];
    return getAllKnownVideos().find((v) => v.id === id) || null;
  }

  function formatNumber(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1).replace(".", ",") + " M";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(".", ",") + " Jt";
    if (num >= 1_000) return (num / 1_000).toFixed(1).replace(".", ",") + " Rb";
    return String(num);
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ss = String(s).padStart(2, "0");
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
    return `${m}:${ss}`;
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2800);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  // =========================================================================
  // Live YouTube Backend API Calls
  // =========================================================================
  function renderSkeletons(count = 12) {
    emptyState.hidden = true;
    videoGrid.innerHTML = Array.from({ length: count }).map(() => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-box skeleton-thumb"></div>
        <div class="skeleton-row">
          <div class="skeleton-box skeleton-avatar"></div>
          <div class="skeleton-lines">
            <div class="skeleton-box skeleton-line"></div>
            <div class="skeleton-box skeleton-line short"></div>
          </div>
        </div>
      </div>
    `).join("");
  }

  async function fetchLiveFeed(category) {
    const token = ++feedRequestToken;
    isLoadingFeed = true;
    renderSkeletons(12);

    try {
      const res = await fetch(`/api/feed?category=${encodeURIComponent(category)}`);
      if (!res.ok) throw new Error("Feed request failed");
      const data = await res.json();
      if (token !== feedRequestToken) return;

      liveFeedVideos = Array.isArray(data.videos) ? data.videos : [];
      liveFeedVideos.forEach(rememberVideo);
      isLoadingFeed = false;
      renderFeed();
    } catch {
      if (token !== feedRequestToken) return;
      isLoadingFeed = false;
      liveFeedVideos = [];
      renderFeed();
      showToast("Gagal memuat feed YouTube. Coba refresh atau periksa koneksi.");
    }
  }

  async function fetchLiveSearch(query) {
    const token = ++feedRequestToken;
    isLoadingFeed = true;
    renderSkeletons(12);

    try {
      // Optional official YouTube Data API v3 if user configured a key
      const apiKey = (state.settings.ytApiKey || "").trim();
      if (apiKey) {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=24&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
        const apiRes = await fetch(url);
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          if (token !== feedRequestToken) return;
          liveSearchVideos = (apiData.items || []).map((item) => ({
            id: "yt-" + item.id.videoId,
            youtubeId: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            channelColor: "#dc2626",
            subscribers: "YouTube Channel",
            views: 0,
            uploadedAt: new Date(item.snippet.publishedAt).toLocaleDateString("id-ID"),
            duration: "YT",
            category: "Pencarian",
            type: "youtube",
            thumb: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
            likes: 0,
            description: item.snippet.description || ""
          }));
          liveSearchVideos.forEach(rememberVideo);
          isLoadingFeed = false;
          renderFeed();
          return;
        }
      }

      // Default: Zero-key Live YouTube Backend (/api/search)
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Search request failed");
      const data = await res.json();
      if (token !== feedRequestToken) return;

      liveSearchVideos = Array.isArray(data.videos) ? data.videos : [];
      liveSearchVideos.forEach(rememberVideo);
      isLoadingFeed = false;
      renderFeed();
    } catch {
      if (token !== feedRequestToken) return;
      isLoadingFeed = false;
      liveSearchVideos = [];
      renderFeed();
      showToast("Gagal mencari di YouTube. Coba lagi beberapa saat.");
    }
  }

  async function hydrateYouTubeWatchDetails(youtubeId) {
    relatedVideosList.innerHTML = `<p class="sidebar-empty">Memuat video terkait dari YouTube...</p>`;
    try {
      const res = await fetch(`/api/video?id=${encodeURIComponent(youtubeId)}`);
      if (!res.ok) throw new Error("Video detail failed");
      const data = await res.json();

      if (data.video && currentVideo && currentVideo.youtubeId === youtubeId) {
        currentVideo = { ...currentVideo, ...data.video };
        rememberVideo(currentVideo);
        saveState();

        watchTitle.textContent = currentVideo.title;
        watchChannelName.innerHTML = `${escapeHtml(currentVideo.channel)}${verifiedBadgeHtml(currentVideo.channelVerified)}`;
        watchChannelAvatar.innerHTML = renderAvatarInner(currentVideo.channelAvatar || state.channelAvatars[currentVideo.channel] || "", currentVideo.channel);
        watchChannelSubs.textContent = currentVideo.subscribers || "YouTube Channel";
        watchStats.textContent = `${formatNumber(currentVideo.views || 0)} ditonton • ${currentVideo.uploadedAt || "YouTube"}`;
        watchDescription.textContent = currentVideo.description || "Tidak ada deskripsi.";
        updateWatchActionStates();
      }

      if (Array.isArray(data.related) && data.related.length > 0) {
        liveRelatedVideos = data.related;
        liveRelatedVideos.forEach(rememberVideo);
        renderRelatedVideos(currentVideo.id, liveRelatedVideos);
      } else {
        renderRelatedVideos(currentVideo.id);
      }
    } catch {
      renderRelatedVideos(currentVideo?.id || "");
    }
  }

  // =========================================================================
  // Theme Management (modern-web-guidance: dark-mode-toggle)
  // =========================================================================
  const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
  const systemDarkMQ = window.matchMedia("(prefers-color-scheme: dark)");

  function getStoredTheme() {
    try {
      const val = localStorage.getItem("color-scheme");
      return val === "light" || val === "dark" ? val : "system";
    } catch {
      return "system";
    }
  }

  function applyTheme(choice, persist = true) {
    const metaValue = choice === "light" || choice === "dark" ? choice : "light dark";
    if (colorSchemeMeta) colorSchemeMeta.content = metaValue;
    if (persist) {
      try {
        if (choice === "system") {
          localStorage.removeItem("color-scheme");
        } else {
          localStorage.setItem("color-scheme", choice);
        }
      } catch {
        // Applied even if storage is blocked
      }
    }
    syncThemeUI(choice);
  }

  function syncThemeUI(choice = getStoredTheme()) {
    const label = $("systemThemeLabel");
    if (label) {
      label.textContent = `Sistem (${systemDarkMQ.matches ? "Gelap" : "Terang"})`;
    }
    document.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.theme === choice));
    });
  }

  systemDarkMQ.addEventListener("change", () => syncThemeUI());
  window.addEventListener("storage", (e) => {
    if (e.key === "color-scheme") applyTheme(getStoredTheme(), false);
  });

  // =========================================================================
  // Light-Dismiss Dialog Fallback (modern-web-guidance: light-dismiss-a-dialog)
  // =========================================================================
  function setupDialogFallbacks() {
    document.querySelectorAll("dialog").forEach((dialog) => {
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        dialog.addEventListener("click", (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent = (
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width
          );
          if (isDialogContent) return;
          dialog.close();
        });
      }
    });

    document.querySelectorAll("[data-close-dialog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dlg = $(btn.dataset.closeDialog);
        if (dlg && dlg.open) dlg.close();
      });
    });
  }

  // =========================================================================
  // Settings & Modes
  // =========================================================================
  function applyVisualSettings() {
    document.body.classList.toggle("focus-mode", !!state.settings.focusMode);
    document.body.classList.toggle("ambient-off", !state.settings.ambientMode);
    $("focusModeTopBtn").setAttribute("aria-pressed", String(!!state.settings.focusMode));
    $("settingFocusMode").checked = !!state.settings.focusMode;
    $("settingAmbientMode").checked = !!state.settings.ambientMode;
    autoplayCheckbox.checked = !!state.settings.autoplay;
    $("ytApiKeyInput").value = state.settings.ytApiKey || "";
  }

  function toggleFocusMode() {
    state.settings.focusMode = !state.settings.focusMode;
    saveState();
    applyVisualSettings();
    showToast(state.settings.focusMode ? "Mode Fokus aktif — distraksi disembunyikan" : "Mode Fokus dimatikan");
  }

  // =========================================================================
  // Sidebar & Navigation
  // =========================================================================
  function updateSidebarBadges() {
    const wlBadge = $("watchLaterCount");
    wlBadge.textContent = state.watchLater.length;
    wlBadge.hidden = state.watchLater.length === 0;

    const likedBadge = $("likedCount");
    likedBadge.textContent = state.liked.length;
    likedBadge.hidden = state.liked.length === 0;

    const subList = $("subscribedChannelsList");
    if (state.subscriptions.length === 0) {
      subList.innerHTML = `<p class="sidebar-empty">Belum ada channel diikuti</p>`;
    } else {
      subList.innerHTML = state.subscriptions.map((ch) => {
        const av = state.channelAvatars[ch] || "";
        return `
          <button class="sub-channel-btn" type="button" data-channel="${escapeHtml(ch)}">
            <span class="sub-channel-dot">${renderAvatarInner(av, ch)}</span>
            <span>${escapeHtml(ch)}</span>
          </button>
        `;
      }).join("");

      subList.querySelectorAll(".sub-channel-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          openChannelProfile(btn.dataset.channel);
          closeMobileDrawer();
        });
      });
    }
  }

  function closeMobileDrawer() {
    document.body.classList.remove("mobile-drawer-open");
    sidebarBackdrop.hidden = true;
  }

  function switchView(viewName, skipFetch = false) {
    activeView = viewName;
    watchView.hidden = true;
    channelView.hidden = true;
    feedView.hidden = false;

    if (!isBgAudioMode) {
      if (!html5Video.paused) html5Video.pause();
      stopYouTubePlayer();
    }

    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.view === viewName);
    });

    if (!skipFetch) {
      if (viewName === "home") {
        renderFeed();
        fetchLiveFeed(activeCategory);
      } else if (viewName === "trending") {
        renderFeed();
        fetchLiveFeed("Populer");
      } else if (viewName === "subscriptions" && state.subscriptions.length > 0) {
        renderFeed();
        fetchLiveSearch(state.subscriptions.slice(0, 3).join(" OR "));
      } else {
        renderFeed();
      }
    } else {
      renderFeed();
    }

    $("mainContent").scrollTo({ top: 0, behavior: "instant" });
  }

  // =========================================================================
  // Render Feed & Video Cards
  // =========================================================================
  function renderCategories() {
    categoryBar.innerHTML = window.BRUTUBE_CATEGORIES.map((cat) => `
      <button
        type="button"
        role="tab"
        class="category-chip ${cat === activeCategory ? "active" : ""}"
        aria-selected="${cat === activeCategory}"
        data-category="${escapeHtml(cat)}"
      >${escapeHtml(cat)}</button>
    `).join("");

    categoryBar.querySelectorAll(".category-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        activeCategory = chip.dataset.category;
        renderCategories();
        fetchLiveFeed(activeCategory);
      });
    });
  }

  function renderFeed() {
    let videos = [];
    let title = "";
    let subtitle = "";
    let actionsHtml = "";

    const showCategories = activeView === "home";
    categoryBar.hidden = !showCategories;

    if (activeView === "home") {
      videos = [...state.customVideos, ...liveFeedVideos];
      feedHeader.hidden = true;
    } else if (activeView === "trending") {
      videos = [...liveFeedVideos];
      title = "Populer di YouTube";
      subtitle = "Video trending & populer langsung dari YouTube, tanpa iklan banner.";
      feedHeader.hidden = false;
    } else if (activeView === "subscriptions") {
      videos = state.subscriptions.length ? [...liveSearchVideos] : [];
      title = "Subscription";
      subtitle = state.subscriptions.length
        ? `Video terbaru dari channel yang Anda ikuti (${state.subscriptions.join(", ")}).`
        : "Subscribe channel YouTube favorit Anda agar videonya muncul di sini.";
      feedHeader.hidden = false;
    } else if (activeView === "history") {
      videos = state.history.map((id) => findVideoById(id)).filter(Boolean);
      title = "Riwayat Tonton";
      subtitle = `${videos.length} video pernah ditonton di perangkat ini.`;
      if (videos.length > 0) {
        actionsHtml = `<button id="clearHistoryBtn" class="btn-pill btn-danger-soft" type="button">Hapus Riwayat</button>`;
      }
      feedHeader.hidden = false;
    } else if (activeView === "watchlater") {
      videos = state.watchLater.map((id) => findVideoById(id)).filter(Boolean);
      title = "Tonton Nanti";
      subtitle = `${videos.length} video tersimpan untuk ditonton nanti.`;
      feedHeader.hidden = false;
    } else if (activeView === "liked") {
      videos = state.liked.map((id) => findVideoById(id)).filter(Boolean);
      title = "Video Disukai";
      subtitle = `${videos.length} video yang Anda sukai.`;
      feedHeader.hidden = false;
    } else if (activeView === "playlists") {
      title = "Playlist Anda";
      subtitle = `${state.playlists.length} playlist tersimpan lokal.`;
      actionsHtml = `<button id="newPlaylistFromFeedBtn" class="btn-pill btn-primary-soft" type="button">+ Buat Playlist</button>`;
      feedHeader.hidden = false;
      feedTitle.textContent = title;
      feedSubtitle.textContent = subtitle;
      feedActions.innerHTML = actionsHtml;
      renderPlaylistsView();
      $("newPlaylistFromFeedBtn")?.addEventListener("click", () => {
        const name = prompt("Nama playlist baru:");
        if (name && name.trim()) {
          state.playlists.push({ id: "pl-" + Date.now(), name: name.trim(), videoIds: [] });
          saveState();
          renderFeed();
          showToast(`Playlist "${name.trim()}" dibuat`);
        }
      });
      return;
    } else if (activeView === "search") {
      videos = [...liveSearchVideos];
      title = `Hasil pencarian YouTube: "${searchQuery}"`;
      subtitle = isLoadingFeed ? "Mencari langsung di YouTube..." : `${videos.length} video ditemukan langsung dari YouTube.`;
      feedHeader.hidden = false;
    }

    feedTitle.textContent = title;
    feedSubtitle.textContent = subtitle;
    feedActions.innerHTML = actionsHtml;

    $("clearHistoryBtn")?.addEventListener("click", () => {
      state.history = [];
      saveState();
      renderFeed();
      showToast("Riwayat tontonan dibersihkan");
    });

    if (isLoadingFeed && (activeView === "home" || activeView === "trending" || activeView === "search" || activeView === "subscriptions")) {
      return;
    }

    if (videos.length === 0) {
      videoGrid.innerHTML = "";
      emptyState.hidden = false;
      emptyStateTitle.textContent = activeView === "search" ? "Video tidak ditemukan di YouTube" : "Daftar ini masih kosong";
      emptyStateDesc.textContent = activeView === "search"
        ? "Coba kata kunci lain atau tempel link YouTube/MP4 langsung di kotak pencarian."
        : "Mulai tonton video YouTube atau tambahkan video dari URL / file lokal Anda.";
      return;
    }

    emptyState.hidden = true;
    videoGrid.innerHTML = videos.map((v) => createVideoCardHTML(v)).join("");

    videoGrid.querySelectorAll(".video-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const chTrigger = e.target.closest("[data-open-channel]");
        if (chTrigger) {
          e.stopPropagation();
          openChannelProfile(chTrigger.dataset.openChannel);
          return;
        }
        openWatchView(card.dataset.id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openWatchView(card.dataset.id);
        }
      });
    });
  }

  function renderPlaylistsView() {
    emptyState.hidden = true;
    videoGrid.innerHTML = state.playlists.map((pl) => {
      const firstVid = pl.videoIds.map(findVideoById).find(Boolean);
      const thumb = firstVid ? firstVid.thumb : window.makeFallbackThumb(pl.name);
      return `
        <article class="video-card playlist-card" data-pl-id="${escapeHtml(pl.id)}" tabindex="0" role="button">
          <div class="thumb-wrap">
            <img class="thumb-img" src="${escapeHtml(thumb)}" alt="${escapeHtml(pl.name)}" loading="lazy">
            <span class="thumb-duration">${pl.videoIds.length} video</span>
            <span class="thumb-source-tag">PLAYLIST</span>
          </div>
          <div class="card-body">
            <div class="card-info">
              <h3 class="card-title">${escapeHtml(pl.name)}</h3>
              <div class="card-meta">${pl.videoIds.length} video tersimpan</div>
            </div>
          </div>
        </article>
      `;
    }).join("");

    videoGrid.querySelectorAll(".playlist-card").forEach((card) => {
      card.addEventListener("click", () => {
        const pl = state.playlists.find((p) => p.id === card.dataset.plId);
        if (!pl) return;
        const vids = pl.videoIds.map(findVideoById).filter(Boolean);
        if (vids.length === 0) {
          showToast(`Playlist "${pl.name}" masih kosong`);
          return;
        }
        openWatchView(vids[0].id);
      });
    });
  }

  function createVideoCardHTML(v) {
    const fallback = window.makeFallbackThumb(v.title);
    const thumbSrc = v.thumb || fallback;
    const viewsText = v.views ? `${formatNumber(v.views)} ditonton` : "YouTube";
    const avatarUrl = v.channelAvatar || state.channelAvatars[v.channel] || "";
    const localTag = v.type === "local" ? `<span class="thumb-source-tag">LOKAL</span>` : "";
    return `
      <article class="video-card" data-id="${escapeHtml(v.id)}" tabindex="0" role="button" aria-label="Tonton ${escapeHtml(v.title)}">
        <div class="thumb-wrap">
          <img class="thumb-img" src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(v.title)}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
          ${localTag}
          ${v.duration ? `<span class="thumb-duration">${escapeHtml(v.duration)}</span>` : ""}
        </div>
        <div class="card-body">
          <div class="card-avatar" data-open-channel="${escapeHtml(v.channel)}" title="Buka profil channel ${escapeHtml(v.channel)}" style="background:${escapeHtml(v.channelColor || "#ef4444")}">${renderAvatarInner(avatarUrl, v.channel)}</div>
          <div class="card-info">
            <h3 class="card-title">${escapeHtml(v.title)}</h3>
            <div class="card-channel">
              <span class="card-channel-link" data-open-channel="${escapeHtml(v.channel)}">${escapeHtml(v.channel)}${verifiedBadgeHtml(v.channelVerified)}</span>
            </div>
            <div class="card-meta">${viewsText} • ${escapeHtml(v.uploadedAt || "Baru-baru ini")}</div>
          </div>
        </div>
      </article>
    `;
  }

  // =========================================================================
  // Watch View & Video Player
  // =========================================================================
  function openWatchView(videoId) {
    const video = findVideoById(videoId);
    if (!video) return;

    currentVideo = video;
    rememberVideo(video);
    feedView.hidden = true;
    channelView.hidden = true;
    watchView.hidden = false;

    state.history = [video.id, ...state.history.filter((id) => id !== video.id)].slice(0, 60);
    saveState();

    if (video.type === "youtube") {
      html5Video.pause();
      html5Video.hidden = true;
      customControls.hidden = true;
      ytPlayerHost.hidden = false;
      loadYouTubePlayer(video.youtubeId);
      watchSourceBadge.textContent = "YouTube HD • Latar Belakang Siap";
    } else {
      stopYouTubePlayer();
      ytPlayerHost.hidden = true;
      html5Video.hidden = false;
      customControls.hidden = false;
      html5Video.src = video.src;
      html5Video.playbackRate = Number(speedSelect.value) || 1;
      html5Video.play().catch(() => {});
      watchSourceBadge.textContent = video.type === "local" ? "Video Lokal • Latar Belakang Siap" : "HD Stream • Latar Belakang Siap";
    }

    syncMediaSessionMetadata(video);
    syncBgAudioOverlay(video);

    const avatarUrl = video.channelAvatar || state.channelAvatars[video.channel] || "";
    watchTitle.textContent = video.title;
    watchChannelAvatar.innerHTML = renderAvatarInner(avatarUrl, video.channel);
    watchChannelAvatar.style.background = video.channelColor || "#ef4444";
    watchChannelName.innerHTML = `${escapeHtml(video.channel)}${verifiedBadgeHtml(video.channelVerified)}`;
    watchChannelSubs.textContent = video.subscribers || "YouTube Channel";
    watchStats.textContent = `${video.views ? formatNumber(video.views) + " ditonton" : "YouTube"} • ${video.uploadedAt || "Baru-baru ini"}`;
    watchDescription.textContent = video.description || "Memuat deskripsi video...";

    updateWatchActionStates();
    renderComments(video.id);
    updateSidebarBadges();

    if (video.type === "youtube" && video.youtubeId) {
      hydrateYouTubeWatchDetails(video.youtubeId);
    } else {
      renderRelatedVideos(video.id);
    }

    $("mainContent").scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateWatchActionStates() {
    if (!currentVideo) return;
    const isLiked = state.liked.includes(currentVideo.id);
    const isDisliked = state.disliked.includes(currentVideo.id);
    const isWL = state.watchLater.includes(currentVideo.id);
    const isSub = state.subscriptions.includes(currentVideo.channel);

    likeBtn.setAttribute("aria-pressed", String(isLiked));
    dislikeBtn.setAttribute("aria-pressed", String(isDisliked));
    likeCountText.textContent = formatNumber((currentVideo.likes || 0) + (isLiked ? 1 : 0));

    watchLaterBtn.classList.toggle("active", isWL);
    watchLaterBtn.querySelector("span").textContent = isWL ? "Tersimpan" : "Tonton Nanti";

    subscribeBtn.classList.toggle("subscribed", isSub);
    subscribeBtn.textContent = isSub ? "Subscribed ✓" : "Subscribe";
  }

  function renderRelatedVideos(currentId, listOverride = null) {
    const source = listOverride || liveFeedVideos || getAllKnownVideos();
    const others = source.filter((v) => v.id !== currentId).slice(0, 14);

    if (others.length === 0) {
      relatedVideosList.innerHTML = `<p class="sidebar-empty">Tidak ada rekomendasi video.</p>`;
      return;
    }

    relatedVideosList.innerHTML = others.map((v) => {
      const fallback = window.makeFallbackThumb(v.title);
      return `
        <article class="related-card" data-id="${escapeHtml(v.id)}" tabindex="0" role="button">
          <div class="related-thumb-wrap">
            <img class="thumb-img" src="${escapeHtml(v.thumb || fallback)}" alt="${escapeHtml(v.title)}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
            ${v.duration ? `<span class="thumb-duration">${escapeHtml(v.duration)}</span>` : ""}
          </div>
          <div class="related-info">
            <h3 class="related-title">${escapeHtml(v.title)}</h3>
            <div class="related-meta">${escapeHtml(v.channel)}</div>
            <div class="related-meta">${v.views ? formatNumber(v.views) + " ditonton" : "YouTube"} • ${escapeHtml(v.uploadedAt || "")}</div>
          </div>
        </article>
      `;
    }).join("");

    relatedVideosList.querySelectorAll(".related-card").forEach((card) => {
      card.addEventListener("click", () => openWatchView(card.dataset.id));
    });
  }

  function renderComments(videoId) {
    const list = state.comments[videoId] || [];
    commentsCountHeading.textContent = `${list.length} Komentar`;
    if (list.length === 0) {
      commentsList.innerHTML = `<p class="sidebar-empty">Belum ada komentar lokal. Jadilah yang pertama berkomentar!</p>`;
      return;
    }
    commentsList.innerHTML = list.map((c) => `
      <div class="comment-item">
        <div class="comment-avatar">${escapeHtml(c.author.charAt(0).toUpperCase())}</div>
        <div class="comment-body">
          <div>
            <span class="comment-author">${escapeHtml(c.author)}</span>
            <span class="comment-time">${escapeHtml(c.time)}</span>
          </div>
          <p class="comment-text">${escapeHtml(c.text)}</p>
        </div>
      </div>
    `).join("");
  }

  // =========================================================================
  // Custom HTML5 Player Controls (for MP4 / Local files)
  // =========================================================================
  function updatePlayPauseIcon() {
    const paused = html5Video.paused;
    playPauseBtn.innerHTML = paused
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  }

  function togglePlayPause() {
    if (html5Video.hidden) return;
    if (html5Video.paused) html5Video.play().catch(() => {});
    else html5Video.pause();
  }

  function showControlsTemporarily() {
    playerContainer.classList.remove("controls-hidden");
    clearTimeout(hideControlsTimer);
    if (!html5Video.paused) {
      hideControlsTimer = setTimeout(() => {
        playerContainer.classList.add("controls-hidden");
      }, 2600);
    }
  }

  html5Video.addEventListener("play", () => { updatePlayPauseIcon(); showControlsTemporarily(); });
  html5Video.addEventListener("pause", () => {
    updatePlayPauseIcon();
    playerContainer.classList.remove("controls-hidden");
    clearTimeout(hideControlsTimer);
  });
  html5Video.addEventListener("click", togglePlayPause);
  html5Video.addEventListener("dblclick", () => fullscreenBtn.click());
  playerContainer.addEventListener("mousemove", showControlsTemporarily);

  html5Video.addEventListener("timeupdate", () => {
    const cur = html5Video.currentTime || 0;
    const dur = html5Video.duration || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    progressPlayed.style.width = `${pct}%`;
    progressThumb.style.left = `${pct}%`;
    progressWrap.setAttribute("aria-valuenow", String(Math.round(pct)));
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  });

  html5Video.addEventListener("progress", () => {
    const dur = html5Video.duration || 0;
    if (dur && html5Video.buffered.length > 0) {
      const end = html5Video.buffered.end(html5Video.buffered.length - 1);
      progressBuffered.style.width = `${(end / dur) * 100}%`;
    }
  });

  html5Video.addEventListener("ended", () => {
    if (!html5Video.loop && state.settings.autoplay && currentVideo) {
      const next = (liveRelatedVideos.length ? liveRelatedVideos : liveFeedVideos).find((v) => v.id !== currentVideo.id);
      if (next) {
        showToast(`Memutar berikutnya: ${next.title}`);
        openWatchView(next.id);
      }
    }
  });

  function seekToClientX(clientX) {
    const rect = progressWrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (html5Video.duration) html5Video.currentTime = ratio * html5Video.duration;
  }

  progressWrap.addEventListener("click", (e) => seekToClientX(e.clientX));
  progressWrap.addEventListener("mousemove", (e) => {
    const rect = progressWrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    progressTooltip.style.left = `${ratio * 100}%`;
    progressTooltip.textContent = formatTime(ratio * (html5Video.duration || 0));
  });

  playPauseBtn.addEventListener("click", togglePlayPause);
  skipBackBtn.addEventListener("click", () => { html5Video.currentTime = Math.max(0, html5Video.currentTime - 10); });
  skipFwdBtn.addEventListener("click", () => { html5Video.currentTime = Math.min(html5Video.duration || 0, html5Video.currentTime + 10); });

  muteBtn.addEventListener("click", () => {
    html5Video.muted = !html5Video.muted;
    volumeSlider.value = html5Video.muted ? 0 : html5Video.volume;
    muteBtn.setAttribute("aria-pressed", String(html5Video.muted));
  });

  volumeSlider.addEventListener("input", () => {
    html5Video.volume = Number(volumeSlider.value);
    html5Video.muted = html5Video.volume === 0;
    muteBtn.setAttribute("aria-pressed", String(html5Video.muted));
  });

  speedSelect.addEventListener("change", () => {
    html5Video.playbackRate = Number(speedSelect.value);
    showToast(`Kecepatan putar: ${speedSelect.value}x`);
  });

  loopBtn.addEventListener("click", () => {
    html5Video.loop = !html5Video.loop;
    loopBtn.setAttribute("aria-pressed", String(html5Video.loop));
    showToast(html5Video.loop ? "Mode Ulangi (Loop) aktif" : "Mode Ulangi dimatikan");
  });

  pipBtn.addEventListener("click", async () => {
    if (!document.pictureInPictureEnabled) {
      showToast("Browser tidak mendukung Picture-in-Picture");
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await html5Video.requestPictureInPicture();
    } catch {
      showToast("Gagal membuka Picture-in-Picture");
    }
  });

  function toggleTheaterMode() {
    const active = document.body.classList.toggle("theater-mode");
    theaterBtn.setAttribute("aria-pressed", String(active));
    theaterBarBtn.classList.toggle("active", active);
  }
  theaterBtn.addEventListener("click", toggleTheaterMode);
  theaterBarBtn.addEventListener("click", toggleTheaterMode);

  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await playerContainer.requestFullscreen();
    } catch {
      showToast("Gagal beralih layar penuh");
    }
  });

  // =========================================================================
  // Add URL / YouTube / Local Video
  // =========================================================================
  function addAndPlayUrl(rawUrl, customTitle = "", category = "Lainnya") {
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;

    const ytId = window.parseYouTubeId(trimmed);
    if (ytId) {
      const id = "yt-" + ytId;
      const existing = findVideoById(id);
      if (existing) {
        openWatchView(existing.id);
        return true;
      }
      const newVid = {
        id,
        youtubeId: ytId,
        title: customTitle.trim() || `Video YouTube (${ytId})`,
        channel: "YouTube Channel",
        channelColor: "#dc2626",
        subscribers: "YouTube",
        views: 0,
        uploadedAt: "YouTube",
        duration: "YT",
        category,
        type: "youtube",
        thumb: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        likes: 0,
        description: "Memuat info video dari YouTube..."
      };
      rememberVideo(newVid);
      saveState();
      openWatchView(newVid.id);
      showToast("Memutar YouTube via No-Cookie Embed");
      return true;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      const newVid = {
        id: "url-" + Date.now(),
        title: customTitle.trim() || trimmed.split("/").pop().split("?")[0] || "Video Stream HD",
        channel: "Stream Langsung",
        channelColor: "#2563eb",
        subscribers: "100% Bebas Iklan",
        views: 1,
        uploadedAt: "Baru ditambahkan",
        duration: "HD",
        category,
        type: "mp4",
        src: trimmed,
        thumb: window.makeFallbackThumb(customTitle.trim() || "HD Video Stream"),
        likes: 0,
        description: `Sumber stream langsung: ${trimmed}`
      };
      state.customVideos.unshift(newVid);
      rememberVideo(newVid);
      saveState();
      openWatchView(newVid.id);
      showToast("Memutar video stream langsung (Bebas Iklan)");
      return true;
    }

    return false;
  }

  function handleLocalFile(file) {
    if (!file || !file.type.startsWith("video/")) {
      showToast("Pilih file video yang valid (.mp4, .webm, .ogg)");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    const newVid = {
      id: "local-" + Date.now(),
      title: cleanName,
      channel: "File Lokal Anda",
      channelColor: "#059669",
      subscribers: "Offline • Privat",
      views: 1,
      uploadedAt: "Baru dibuka",
      duration: "LOKAL",
      category: "Lainnya",
      type: "local",
      src: objectUrl,
      thumb: window.makeFallbackThumb(cleanName),
      likes: 0,
      description: `File lokal: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB). Diputar langsung di browser tanpa unggahan dan 100% tanpa iklan.`
    };
    state.customVideos.unshift(newVid);
    addVideoDialog.close();
    openWatchView(newVid.id);
    showToast(`Memutar file lokal: ${cleanName}`);
  }

  // =========================================================================
  // Event Wiring
  // =========================================================================
  function bindEvents() {
    menuToggleBtn.addEventListener("click", () => {
      if (window.innerWidth <= 820) {
        const open = document.body.classList.toggle("mobile-drawer-open");
        sidebarBackdrop.hidden = !open;
        menuToggleBtn.setAttribute("aria-expanded", String(open));
      } else {
        const collapsed = document.body.classList.toggle("sidebar-collapsed");
        menuToggleBtn.setAttribute("aria-expanded", String(!collapsed));
      }
    });

    sidebarBackdrop.addEventListener("click", closeMobileDrawer);

    $("brandLogo").addEventListener("click", (e) => {
      e.preventDefault();
      activeCategory = "Semua";
      searchQuery = "";
      searchInput.value = "";
      clearSearchBtn.hidden = true;
      renderCategories();
      switchView("home");
    });

    document.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        switchView(item.dataset.view);
        closeMobileDrawer();
      });
    });

    searchInput.addEventListener("input", () => {
      clearSearchBtn.hidden = searchInput.value.length === 0;
    });

    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchQuery = "";
      clearSearchBtn.hidden = true;
      if (activeView === "search") switchView("home");
      searchInput.focus();
    });

    searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;

      if (window.parseYouTubeId(q) || /^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(q)) {
        if (addAndPlayUrl(q)) return;
      }

      searchQuery = q;
      switchView("search", true);
      await fetchLiveSearch(q);
    });

    // Modals
    $("addVideoBtn").addEventListener("click", () => addVideoDialog.showModal());
    $("emptyActionBtn").addEventListener("click", () => addVideoDialog.showModal());
    $("settingsBtn").addEventListener("click", () => {
      syncThemeUI();
      settingsDialog.showModal();
    });
    $("shortcutsBtn").addEventListener("click", () => shortcutsDialog.showModal());
    $("focusModeTopBtn").addEventListener("click", toggleFocusMode);

    document.querySelectorAll(".modal-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".modal-tab").forEach((t) => {
          t.classList.toggle("active", t === tab);
          t.setAttribute("aria-selected", String(t === tab));
        });
        document.querySelectorAll(".modal-panel").forEach((panel) => {
          panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        });
      });
    });

    $("addUrlForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const ok = addAndPlayUrl(
        $("videoUrlInput").value,
        $("videoTitleInput").value,
        $("videoCategoryInput").value
      );
      if (ok) {
        $("addUrlForm").reset();
        addVideoDialog.close();
      } else {
        showToast("URL tidak valid. Masukkan link YouTube atau link .mp4/.webm");
      }
    });

    const localFileInput = $("localFileInput");
    const dropZone = $("dropZone");
    $("browseLocalBtn").addEventListener("click", () => localFileInput.click());
    localFileInput.addEventListener("change", () => {
      if (localFileInput.files?.[0]) handleLocalFile(localFileInput.files[0]);
      localFileInput.value = "";
    });
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      if (e.dataTransfer.files?.[0]) handleLocalFile(e.dataTransfer.files[0]);
    });

    document.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTheme(btn.dataset.theme, true);
        showToast(`Tema diubah ke: ${btn.textContent.trim()}`);
      });
    });

    $("settingFocusMode").addEventListener("change", (e) => {
      state.settings.focusMode = e.target.checked;
      saveState();
      applyVisualSettings();
    });

    $("settingAmbientMode").addEventListener("change", (e) => {
      state.settings.ambientMode = e.target.checked;
      saveState();
      applyVisualSettings();
    });

    autoplayCheckbox.addEventListener("change", (e) => {
      state.settings.autoplay = e.target.checked;
      saveState();
    });

    $("saveApiKeyBtn").addEventListener("click", () => {
      state.settings.ytApiKey = $("ytApiKeyInput").value.trim();
      saveState();
      showToast(state.settings.ytApiKey ? "YouTube API Key disimpan" : "API Key kosong");
    });

    $("clearApiKeyBtn").addEventListener("click", () => {
      state.settings.ytApiKey = "";
      $("ytApiKeyInput").value = "";
      saveState();
      showToast("YouTube API Key dihapus");
    });

    $("resetDataBtn").addEventListener("click", () => {
      if (confirm("Hapus semua riwayat, playlist, dan video tambahan?")) {
        localStorage.removeItem(STORAGE_KEY);
        state = structuredClone(defaultState);
        applyVisualSettings();
        updateSidebarBadges();
        switchView("home");
        settingsDialog.close();
        showToast("Semua data lokal berhasil direset");
      }
    });

    // Watch Actions
    likeBtn.addEventListener("click", () => {
      if (!currentVideo) return;
      const id = currentVideo.id;
      rememberVideo(currentVideo);
      if (state.liked.includes(id)) {
        state.liked = state.liked.filter((x) => x !== id);
      } else {
        state.liked.unshift(id);
        state.disliked = state.disliked.filter((x) => x !== id);
      }
      saveState();
      updateWatchActionStates();
      updateSidebarBadges();
    });

    dislikeBtn.addEventListener("click", () => {
      if (!currentVideo) return;
      const id = currentVideo.id;
      if (state.disliked.includes(id)) {
        state.disliked = state.disliked.filter((x) => x !== id);
      } else {
        state.disliked.unshift(id);
        state.liked = state.liked.filter((x) => x !== id);
      }
      saveState();
      updateWatchActionStates();
      updateSidebarBadges();
    });

    watchLaterBtn.addEventListener("click", () => {
      if (!currentVideo) return;
      const id = currentVideo.id;
      rememberVideo(currentVideo);
      if (state.watchLater.includes(id)) {
        state.watchLater = state.watchLater.filter((x) => x !== id);
        showToast("Dihapus dari Tonton Nanti");
      } else {
        state.watchLater.unshift(id);
        showToast("Disimpan ke Tonton Nanti");
      }
      saveState();
      updateWatchActionStates();
      updateSidebarBadges();
    });

    subscribeBtn.addEventListener("click", () => {
      if (!currentVideo) return;
      const ch = currentVideo.channel;
      if (state.subscriptions.includes(ch)) {
        state.subscriptions = state.subscriptions.filter((x) => x !== ch);
        showToast(`Berhenti mengikuti ${ch}`);
      } else {
        state.subscriptions.unshift(ch);
        showToast(`Mengikuti ${ch}`);
      }
      saveState();
      updateWatchActionStates();
      updateSidebarBadges();
    });

    shareBtn.addEventListener("click", async () => {
      if (!currentVideo) return;
      const shareText = currentVideo.type === "youtube"
        ? `https://youtu.be/${currentVideo.youtubeId}`
        : currentVideo.src || window.location.href;
      try {
        await navigator.clipboard.writeText(shareText);
        showToast("Tautan video disalin ke clipboard");
      } catch {
        showToast("Tautan: " + shareText);
      }
    });

    savePlaylistBtn.addEventListener("click", () => {
      if (!currentVideo) return;
      rememberVideo(currentVideo);
      renderPlaylistModal();
      playlistDialog.showModal();
    });

    $("createPlaylistForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("newPlaylistName");
      const name = input.value.trim();
      if (!name || !currentVideo) return;
      rememberVideo(currentVideo);
      state.playlists.push({ id: "pl-" + Date.now(), name, videoIds: [currentVideo.id] });
      saveState();
      input.value = "";
      renderPlaylistModal();
      showToast(`Disimpan ke playlist "${name}"`);
    });

    commentForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!currentVideo) return;
      const text = commentInput.value.trim();
      if (!text) return;
      if (!state.comments[currentVideo.id]) state.comments[currentVideo.id] = [];
      state.comments[currentVideo.id].unshift({
        author: "Anda",
        time: "Baru saja",
        text
      });
      saveState();
      commentInput.value = "";
      renderComments(currentVideo.id);
      showToast("Komentar ditambahkan");
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInput.focus();
        return;
      }
      if (e.key === "?") {
        shortcutsDialog.showModal();
        return;
      }
      if (watchView.hidden) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlayPause();
          break;
        case "j":
          html5Video.currentTime = Math.max(0, html5Video.currentTime - 10);
          break;
        case "l":
          html5Video.currentTime = Math.min(html5Video.duration || 0, html5Video.currentTime + 10);
          break;
        case "arrowleft":
          html5Video.currentTime = Math.max(0, html5Video.currentTime - 5);
          break;
        case "arrowright":
          html5Video.currentTime = Math.min(html5Video.duration || 0, html5Video.currentTime + 5);
          break;
        case "m":
          muteBtn.click();
          break;
        case "t":
          toggleTheaterMode();
          break;
        case "f":
          fullscreenBtn.click();
          break;
        case "c":
          toggleFocusMode();
          break;
      }
    });
  }

  function renderPlaylistModal() {
    const container = $("playlistCheckboxes");
    container.innerHTML = state.playlists.map((pl) => {
      const checked = pl.videoIds.includes(currentVideo.id);
      return `
        <label class="playlist-check-item">
          <input type="checkbox" data-pl-id="${escapeHtml(pl.id)}" ${checked ? "checked" : ""}>
          <span>${escapeHtml(pl.name)}</span>
          <span class="nav-badge">${pl.videoIds.length}</span>
        </label>
      `;
    }).join("");

    container.querySelectorAll("input[type='checkbox']").forEach((cb) => {
      cb.addEventListener("change", () => {
        const pl = state.playlists.find((p) => p.id === cb.dataset.plId);
        if (!pl) return;
        if (cb.checked) {
          if (!pl.videoIds.includes(currentVideo.id)) pl.videoIds.push(currentVideo.id);
        } else {
          pl.videoIds = pl.videoIds.filter((id) => id !== currentVideo.id);
        }
        saveState();
        renderPlaylistModal();
      });
    });
  }

  // =========================================================================
  // YouTube-Style Channel Profile Page
  // =========================================================================
  async function openChannelProfile(channelName) {
    if (!channelName) return;
    feedView.hidden = true;
    watchView.hidden = true;
    channelView.hidden = false;

    if (!isBgAudioMode) {
      if (!html5Video.paused) html5Video.pause();
      stopYouTubePlayer();
    }

    const cachedAvatar = state.channelAvatars[channelName] || "";
    $("channelProfileName").textContent = channelName;
    $("channelProfileMeta").textContent = "Memuat profil channel dari YouTube...";
    $("channelProfileAvatar").innerHTML = renderAvatarInner(cachedAvatar, channelName);
    $("channelVideoGrid").innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-box skeleton-thumb"></div>
        <div class="skeleton-row">
          <div class="skeleton-box skeleton-avatar"></div>
          <div class="skeleton-lines">
            <div class="skeleton-box skeleton-line"></div>
            <div class="skeleton-box skeleton-line short"></div>
          </div>
        </div>
      </div>
    `).join("");

    $("mainContent").scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch(`/api/channel?name=${encodeURIComponent(channelName)}`);
      if (!res.ok) throw new Error("Channel load failed");
      const profile = await res.json();
      activeChannelProfile = profile;
      activeChannelTab = "latest";
      if (profile.avatar) state.channelAvatars[profile.name] = profile.avatar;
      (profile.videos || []).forEach(rememberVideo);
      renderChannelProfile();
    } catch {
      $("channelProfileMeta").textContent = "Gagal memuat profil channel.";
      $("channelVideoGrid").innerHTML = "";
    }
  }

  function renderChannelProfile() {
    if (!activeChannelProfile) return;
    const p = activeChannelProfile;
    const isSub = state.subscriptions.includes(p.name);

    $("channelBanner").style.background = `linear-gradient(125deg, #0f172a 0%, ${p.color || "#334155"} 60%, #dc2626 100%)`;
    $("channelProfileAvatar").style.background = p.color || "#ef4444";
    $("channelProfileAvatar").innerHTML = renderAvatarInner(p.avatar, p.name);
    $("channelProfileName").innerHTML = `${escapeHtml(p.name)}${verifiedBadgeHtml(p.verified)}`;
    $("channelProfileMeta").textContent = `${p.handle} • ${p.subscribers} • ${p.videoCount} video`;

    const chSubBtn = $("channelSubscribeBtn");
    chSubBtn.classList.toggle("subscribed", isSub);
    chSubBtn.textContent = isSub ? "Subscribed ✓" : "Subscribe";

    document.querySelectorAll(".channel-tab").forEach((t) => {
      const active = t.dataset.chTab === activeChannelTab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });

    const list = activeChannelTab === "popular"
      ? [...(p.videos || [])].sort((a, b) => (b.views || 0) - (a.views || 0))
      : (p.videos || []);

    const grid = $("channelVideoGrid");
    grid.innerHTML = list.map((v) => createVideoCardHTML(v)).join("");
    grid.querySelectorAll(".video-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-open-channel]")) return;
        openWatchView(card.dataset.id);
      });
    });
  }

  // =========================================================================
  // YouTube-Style Top-Right Account Profile Menu
  // =========================================================================
  function renderAccountProfile() {
    const prof = state.profile || defaultState.profile;
    const avatarHtml = renderAvatarInner(prof.avatarUrl, prof.name);
    $("accountAvatarContent").innerHTML = avatarHtml;
    $("dropdownAvatar").innerHTML = avatarHtml;
    $("dropdownName").textContent = prof.name;
    $("dropdownHandle").textContent = prof.handle;

    const theme = getStoredTheme();
    const themeMap = { system: "Sistem", light: "Terang", dark: "Gelap" };
    $("menuThemeLabel").textContent = `Tampilan: ${themeMap[theme] || "Sistem"}`;
    $("menuFocusLabel").textContent = `Mode Fokus: ${state.settings.focusMode ? "Aktif" : "Nonaktif"}`;
  }

  function bindProfileAndChannelEvents() {
    const accountBtn = $("accountAvatarBtn");
    const dropdown = $("accountDropdown");
    const profileDialog = $("profileDialog");

    function closeDropdown() {
      dropdown.hidden = true;
      accountBtn.setAttribute("aria-expanded", "false");
    }

    accountBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderAccountProfile();
      const willOpen = dropdown.hidden;
      dropdown.hidden = !willOpen;
      accountBtn.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", (e) => {
      if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== accountBtn) {
        closeDropdown();
      }
    });

    dropdown.querySelectorAll("[data-account-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeDropdown();
        switchView(btn.dataset.accountNav);
      });
    });

    $("menuThemeBtn").addEventListener("click", () => {
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(getStoredTheme()) + 1) % order.length];
      applyTheme(next, true);
      renderAccountProfile();
      showToast(`Tema diubah ke: ${next === "system" ? "Sistem" : next === "light" ? "Terang" : "Gelap"}`);
    });

    $("menuFocusBtn").addEventListener("click", () => {
      toggleFocusMode();
      renderAccountProfile();
    });

    $("menuSettingsBtn").addEventListener("click", () => {
      closeDropdown();
      syncThemeUI();
      settingsDialog.showModal();
    });

    $("openEditProfileBtn").addEventListener("click", () => {
      closeDropdown();
      $("profileNameInput").value = state.profile.name || "";
      $("profileHandleInput").value = state.profile.handle || "";
      $("profileAvatarUrlInput").value = state.profile.avatarUrl || "";
      profileDialog.showModal();
    });

    $("profileForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("profileNameInput").value.trim() || "Pengguna BruTube";
      let handle = $("profileHandleInput").value.trim() || "@brutube_user";
      if (!handle.startsWith("@")) handle = "@" + handle;
      const avatarUrl = $("profileAvatarUrlInput").value.trim();

      state.profile = { name, handle, avatarUrl };
      saveState();
      renderAccountProfile();
      profileDialog.close();
      showToast("Profil akun diperbarui");
    });

    // Open channel profile when clicking channel avatar/name on Watch page
    watchChannelAvatar.addEventListener("click", () => {
      if (currentVideo?.channel) openChannelProfile(currentVideo.channel);
    });
    watchChannelName.addEventListener("click", () => {
      if (currentVideo?.channel) openChannelProfile(currentVideo.channel);
    });

    // Channel page controls
    $("channelBackBtn").addEventListener("click", () => switchView("home", true));
    $("channelSubscribeBtn").addEventListener("click", () => {
      if (!activeChannelProfile) return;
      const ch = activeChannelProfile.name;
      if (state.subscriptions.includes(ch)) {
        state.subscriptions = state.subscriptions.filter((x) => x !== ch);
        showToast(`Berhenti mengikuti ${ch}`);
      } else {
        state.subscriptions.unshift(ch);
        showToast(`Mengikuti ${ch}`);
      }
      saveState();
      updateSidebarBadges();
      renderChannelProfile();
    });

    document.querySelectorAll(".channel-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeChannelTab = tab.dataset.chTab;
        renderChannelProfile();
      });
    });
  }

  // =========================================================================
  // Background Playback, YouTube IFrame API & Media Session Lock-Screen API
  // =========================================================================
  function playNextVideo() {
    if (!currentVideo) return;
    const pool = liveRelatedVideos.length ? liveRelatedVideos : liveFeedVideos;
    const next = pool.find((v) => v.id !== currentVideo.id);
    if (next) openWatchView(next.id);
  }

  function playPrevVideo() {
    if (state.history.length > 1) {
      openWatchView(state.history[1]);
    }
  }

  function isCurrentMediaPlaying() {
    if (!currentVideo) return false;
    if (currentVideo.type === "youtube" && ytPlayer && typeof ytPlayer.getPlayerState === "function") {
      return ytPlayer.getPlayerState() === 1;
    }
    return !html5Video.hidden && !html5Video.paused;
  }

  function playCurrentMedia() {
    if (!currentVideo) return;
    if (currentVideo.type === "youtube" && ytPlayer && typeof ytPlayer.playVideo === "function") {
      ytPlayer.playVideo();
    } else if (!html5Video.hidden) {
      html5Video.play().catch(() => {});
    }
  }

  function pauseCurrentMedia() {
    if (!currentVideo) return;
    if (currentVideo.type === "youtube" && ytPlayer && typeof ytPlayer.pauseVideo === "function") {
      ytPlayer.pauseVideo();
    } else if (!html5Video.hidden) {
      html5Video.pause();
    }
  }

  function seekCurrentMediaBy(deltaSec) {
    if (!currentVideo) return;
    if (currentVideo.type === "youtube" && ytPlayer && typeof ytPlayer.getCurrentTime === "function") {
      const target = Math.max(0, ytPlayer.getCurrentTime() + deltaSec);
      ytPlayer.seekTo(target, true);
    } else if (!html5Video.hidden) {
      html5Video.currentTime = Math.max(0, Math.min(html5Video.duration || 0, html5Video.currentTime + deltaSec));
    }
  }

  function stopYouTubePlayer() {
    pendingYouTubeId = null;
    if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
      try { ytPlayer.stopVideo(); } catch {}
    } else {
      ytPlayerHost.innerHTML = "";
    }
  }

  function ensureIframeReferrerPolicy() {
    const iframe = ytPlayerHost.querySelector("iframe");
    if (iframe) {
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    }
  }

  function loadYouTubePlayer(videoId) {
    if (!videoId) return;
    if (ytApiReady && window.YT && window.YT.Player) {
      if (ytPlayer && typeof ytPlayer.loadVideoById === "function") {
        ytPlayer.loadVideoById(videoId);
        ensureIframeReferrerPolicy();
        return;
      }
      ytPlayerHost.innerHTML = `<div id="ytPlayerMount"></div>`;
      ytPlayer = new window.YT.Player("ytPlayerMount", {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (ev) => {
            ensureIframeReferrerPolicy();
            try { ev.target.playVideo(); } catch {}
          },
          onStateChange: (ev) => {
            if (!("mediaSession" in navigator)) return;
            if (ev.data === 1) {
              navigator.mediaSession.playbackState = "playing";
            } else if (ev.data === 2) {
              navigator.mediaSession.playbackState = "paused";
            } else if (ev.data === 0 && state.settings.autoplay) {
              playNextVideo();
            }
          }
        }
      });
      ensureIframeReferrerPolicy();
    } else {
      pendingYouTubeId = videoId;
      const originParam = encodeURIComponent(window.location.origin);
      ytPlayerHost.innerHTML = `<iframe class="video-iframe" title="Pemutar Video YouTube" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${originParam}"></iframe>`;
    }
  }

  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    if (pendingYouTubeId && currentVideo && currentVideo.youtubeId === pendingYouTubeId) {
      const id = pendingYouTubeId;
      pendingYouTubeId = null;
      loadYouTubePlayer(id);
    }
  };

  function syncMediaSessionMetadata(video) {
    if (!("mediaSession" in navigator) || !video) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: video.title || "BruTube",
        artist: video.channel || "BruTube",
        album: "BruTube",
        artwork: video.thumb ? [{ src: video.thumb, sizes: "480x360", type: "image/jpeg" }] : []
      });
      navigator.mediaSession.playbackState = "playing";
    } catch {
      // Ignore unsupported MediaMetadata errors
    }
  }

  function setupMediaSessionHandlers() {
    if (!("mediaSession" in navigator)) return;
    const safeHandler = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
    };
    safeHandler("play", () => playCurrentMedia());
    safeHandler("pause", () => pauseCurrentMedia());
    safeHandler("previoustrack", () => playPrevVideo());
    safeHandler("nexttrack", () => playNextVideo());
    safeHandler("seekbackward", (d) => seekCurrentMediaBy(-(d?.seekOffset || 10)));
    safeHandler("seekforward", (d) => seekCurrentMediaBy(d?.seekOffset || 10));
    safeHandler("seekto", (d) => {
      if (typeof d?.seekTime !== "number") return;
      if (currentVideo?.type === "youtube" && ytPlayer && typeof ytPlayer.seekTo === "function") {
        ytPlayer.seekTo(d.seekTime, true);
      } else if (!html5Video.hidden) {
        html5Video.currentTime = d.seekTime;
      }
    });

    html5Video.addEventListener("play", () => {
      navigator.mediaSession.playbackState = "playing";
    });
    html5Video.addEventListener("pause", () => {
      navigator.mediaSession.playbackState = "paused";
    });
  }

  function syncBgAudioOverlay(video) {
    if (!video) return;
    const fallback = window.makeFallbackThumb(video.title);
    $("bgAudioThumb").src = video.thumb || fallback;
    $("bgAudioTitle").textContent = video.title || "Memutar...";
    $("bgAudioChannel").textContent = video.channel || "BruTube";
  }

  function toggleBgAudioMode(forceState) {
    isBgAudioMode = typeof forceState === "boolean" ? forceState : !isBgAudioMode;
    bgAudioOverlay.hidden = !isBgAudioMode;
    bgAudioBtn.setAttribute("aria-pressed", String(isBgAudioMode));
    bgAudioBtn.classList.toggle("active", isBgAudioMode);
    if (currentVideo) syncBgAudioOverlay(currentVideo);
    showToast(
      isBgAudioMode
        ? "Mode Latar Belakang aktif — kontrol layar kunci & audio siap"
        : "Kembali ke tampilan video"
    );
  }

  function bindBackgroundPlaybackEvents() {
    bgAudioBtn.addEventListener("click", () => toggleBgAudioMode());
    $("bgExitBtn").addEventListener("click", () => toggleBgAudioMode(false));
    $("bgPlayPauseBtn").addEventListener("click", () => {
      if (isCurrentMediaPlaying()) pauseCurrentMedia();
      else playCurrentMedia();
    });
    $("bgNextBtn").addEventListener("click", playNextVideo);
    $("bgPrevBtn").addEventListener("click", playPrevVideo);

    // Keep playback resilient when user switches tabs, minimizes browser, or locks screen
    document.addEventListener("visibilitychange", () => {
      if (!currentVideo) return;
      if (document.hidden) {
        wasPlayingBeforeHide = isCurrentMediaPlaying();
        if (wasPlayingBeforeHide) {
          syncMediaSessionMetadata(currentVideo);
          // Gently keep playback running if browser tries to pause on visibility change
          setTimeout(() => {
            if (document.hidden && wasPlayingBeforeHide && !isCurrentMediaPlaying()) {
              playCurrentMedia();
            }
          }, 250);
        }
      }
    });
  }

  // Initialize
  setupDialogFallbacks();
  setupMediaSessionHandlers();
  syncThemeUI();
  applyVisualSettings();
  renderAccountProfile();
  renderCategories();
  updateSidebarBadges();
  bindEvents();
  bindProfileAndChannelEvents();
  bindBackgroundPlaybackEvents();
  fetchLiveFeed(activeCategory);
})();
