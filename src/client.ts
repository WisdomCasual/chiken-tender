import "./styles.css";
import PartySocket from "partysocket";

declare const google: any; 
let selectedLat = "";
let selectedLng = "";
let googleMap: any = null;

const output = document.getElementById("app") as HTMLDivElement;

const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get("room");
const isHosting = !roomCode;
if (!roomCode) {
  roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
}
window.history.replaceState({}, '', `?room=${roomCode}`);

const conn = new PartySocket({
  host: window.location.host,
  room: roomCode, 
});

let restaurants: any[] = []; 
let myName = "";
let currentIndex = 0;
let currentImageIndex = 0; 
let serverState: any = { state: 'lobby', users: [] };
let visualTimerInterval: number | null = null;
let isKicked = false;

// --- UTILS ---

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function shuffleArray(array: any[]) {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

function showInviteModal() {
  const url = window.location.href;
  const text = "Help me pick a place to eat!";
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text + "\n" + url);

  const modal = document.createElement('div');
  modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-[fadeIn_0.2s_ease-out]";
  
  modal.innerHTML = `
    <div class="border-8 border-black bg-neo-bg p-6 max-w-sm w-full shadow-neo-xl rotate-1 flex flex-col gap-4 relative">
      <button id="close-modal" class="neo-press absolute -top-5 -right-5 bg-neo-accent border-4 border-black text-white font-black w-12 h-12 rounded-full flex items-center justify-center shadow-neo-sm hover:bg-red-600 text-xl">X</button>
      <h3 class="text-3xl font-black uppercase tracking-tighter mb-2">Invite Friends</h3>
      <button id="invite-copy" class="neo-press border-4 border-black bg-neo-secondary px-4 py-4 font-black text-xl flex items-center justify-between hover:bg-yellow-300 transition-colors">
        <span>COPY LINK</span> 
        <svg class="w-8 h-8" fill="none" stroke="black" stroke-width="3" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="square" stroke-linejoin="miter" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
      </button>
      <a href="https://api.whatsapp.com/send?text=${encodedText}" target="_blank" class="neo-press border-4 border-black bg-[#4ade80] px-4 py-4 font-black text-xl flex items-center justify-between hover:bg-green-300 transition-colors">
        <span>WHATSAPP</span> 
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="black" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
      </a>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("close-modal")?.addEventListener("click", () => modal.remove());
  document.getElementById("invite-copy")?.addEventListener("click", () => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
      const btn = document.getElementById("invite-copy");
      if(btn) {
        btn.innerHTML = `<span>COPIED!</span> <span class="text-2xl">✅</span>`;
        btn.classList.replace("bg-neo-secondary", "bg-white");
      }
      setTimeout(() => modal.remove(), 1000);
    } catch (err) {
      prompt("Copy this link:", url);
    }
  });
}

function startVisualTimer() {
  if (visualTimerInterval) clearInterval(visualTimerInterval);
  visualTimerInterval = window.setInterval(() => {
    const timerEl = document.getElementById('global-timer-text');
    if (!timerEl || !serverState.startedAt) return;
    const elapsed = Math.floor((Date.now() - serverState.startedAt) / 1000);
    const remaining = Math.max(0, serverState.timeLimit - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    timerEl.innerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (remaining <= 30 && remaining > 0) {
      timerEl.parentElement?.classList.add("text-neo-accent", "animate-pulse");
    }
    if (remaining === 0) {
      clearInterval(visualTimerInterval!);
      const me = serverState.users.find((u: any) => u.id === conn.id);
      if (me?.isHost) {
        conn.send(JSON.stringify({ type: "trigger_nuclear" }));
      }
    }
  }, 1000);
}

// --- COMBO API LOGIC (V2 Data + Local Business Photos) ---
async function fetchRestaurantsAndStart(timeLimit: number, radius: number, limit: number) {
  if (!selectedLat || !selectedLng) {
    alert("Please drop a pin or select a location first!");
    return;
  }
  
  if (!serverState.rapidApiKey) {
    alert("Missing RAPID_API_KEY in .env file!");
    return;
  }

  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  if (btn) {
    btn.innerText = "FETCHING COMBINED DATA...";
    btn.disabled = true;
  }

  const apiKey = serverState.rapidApiKey;

  // 1. Setup V2 Request (No photos requested to save quota!)
  const v2Host = 'google-map-places-new-v2.p.rapidapi.com';
  const v2Url = `https://${v2Host}/v1/places:searchNearby`;
  const v2Options = {
    method: 'POST',
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': v2Host,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.primaryTypeDisplayName,places.formattedAddress,places.location,places.googleMapsUri',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      includedPrimaryTypes: ['restaurant'],
      locationRestriction: {
        circle: {
          center: { latitude: parseFloat(selectedLat), longitude: parseFloat(selectedLng) },
          radius: radius
        }
      },
      maxResultCount: 20,
      rankPreference: 'POPULARITY'
    })
  };

  // 2. Setup Local Business Request (To extract photos in bulk)
  const imgHost = 'local-business-data.p.rapidapi.com';
  const imgUrl = `https://${imgHost}/search-in-area?query=restaurant&lat=${selectedLat}&lng=${selectedLng}&zoom=14&limit=50`;
  const imgOptions = {
    method: 'GET',
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': imgHost
    }
  };

  try {
    // 3. Fire BOTH requests concurrently (Only uses 2 API quota hits total!)
    const [v2Response, imgResponse] = await Promise.all([
      fetch(v2Url, v2Options),
      fetch(imgUrl, imgOptions)
    ]);

    const v2Data = await v2Response.json();
    const imgData = await imgResponse.json();

    if (v2Data.places && v2Data.places.length > 0) {
      
      // 4. Create an extremely fast lookup dictionary for images using the Google Place ID
      const imageLookup: Record<string, string[]> = {};
      if (imgData.data) {
        imgData.data.forEach((place: any) => {
          if (place.photos_sample && place.photos_sample.length > 0) {
            imageLookup[place.place_id] = place.photos_sample.map((p: any) => p.photo_url_large || p.photo_url);
          }
        });
      }

      // 5. Build our beautiful combo array
      const placesWithDistance = v2Data.places.map((place: any) => {
        const dist = place.location 
          ? calculateDistance(parseFloat(selectedLat), parseFloat(selectedLng), place.location.latitude, place.location.longitude) 
          : 999;
        
        // Grab photos from our bulk dictionary, or start empty
        let finalImages = imageLookup[place.id] || [];

        // Pad arrays so the UI image carousel always looks great
        if (finalImages.length === 1) {
          finalImages.push("https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&q=80");
          finalImages.push("https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80");
        } else if (finalImages.length === 0) {
          finalImages = [
            "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
            "https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?w=600&q=80"
          ];
        }

        return {
          id: place.id,
          name: place.displayName?.text ? place.displayName.text.toUpperCase() : "UNKNOWN PLACE",
          rating: place.rating || 0,
          type: place.primaryTypeDisplayName?.text || "Dining",
          color: "bg-white",
          images: finalImages,
          address: place.formattedAddress || "Address Hidden",
          googleMapsUri: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${place.location?.latitude},${place.location?.longitude}`,
          distance: dist
        };
      });

      // 6. Strict Radius Filtering
      const maxDistanceKm = radius / 1000;
      const validPlaces = placesWithDistance.filter((p: any) => p.distance <= maxDistanceKm);

      // 7. Sort by Rating, then Distance
      validPlaces.sort((a: any, b: any) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return a.distance - b.distance; 
      });

      // 8. Slice and Shuffle
      const topPlaces = validPlaces.slice(0, limit);
      const realRestaurants = shuffleArray(topPlaces);

      if (realRestaurants.length === 0) {
        alert(`No restaurants found strictly within ${maxDistanceKm}km! Try expanding your radius.`);
        if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
        return;
      }

      // 9. Go!
      conn.send(JSON.stringify({ 
        type: "start_room", 
        timeLimit, 
        radius, 
        location: "Target Area",
        restaurants: realRestaurants 
      }));
    } else {
      alert("No restaurants found in this radius! Try adjusting the map pin.");
      if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
    }
  } catch (err) {
    console.error("Combo API Fetch Error:", err);
    alert("Could not fetch data. Ensure you subscribed to both APIs on RapidAPI.");
    if (btn) { btn.innerText = "START SWIPING"; btn.disabled = false; }
  }
}

// --- RENDER SCREENS ---

function renderLogin() {
  if (isKicked) return;
  output.innerHTML = `
    <div class="flex flex-col h-screen items-center justify-center p-6 animate-[fadeIn_0.3s_ease-out]">
      <div class="border-8 border-black bg-white p-8 shadow-neo-xl w-full max-w-sm transform rotate-1">
        <h1 class="text-4xl font-black uppercase tracking-tighter mb-2">${isHosting ? 'Host a Room' : 'Join Room'}</h1>
        <p class="font-bold border-2 border-black inline-block px-2 bg-neo-muted mb-6 tracking-widest">${roomCode}</p>
        <input type="text" id="name-input" placeholder="YOUR NAME" class="w-full border-4 border-black p-4 text-xl font-bold uppercase mb-6 focus:bg-neo-secondary focus:outline-none transition-colors" maxlength="12">
        <button id="join-btn" class="neo-press w-full border-4 border-black bg-neo-accent text-white py-4 text-2xl font-black uppercase shadow-neo-md transition-colors hover:bg-red-500">ENTER CHAOS</button>
      </div>
    </div>
  `;

  const attemptJoin = () => {
    const input = document.getElementById("name-input") as HTMLInputElement;
    const nameVal = input.value.trim().toUpperCase();
    if (nameVal) {
      myName = nameVal;
      conn.send(JSON.stringify({ type: "join", name: myName }));
    }
  };

  document.getElementById("join-btn")?.addEventListener("click", attemptJoin);
  document.getElementById("name-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      attemptJoin();
    }
  });
}

function renderLobby() {
  if (isKicked) return;
  const me = serverState.users.find((u: any) => u.id === conn.id);
  if (me) myName = me.name; 

  const userHtml = serverState.users.map((u: any) => `
    <div class="border-4 border-black p-3 mb-2 font-bold flex justify-between items-center ${u.id === conn.id ? 'bg-neo-secondary' : 'bg-white'} shadow-neo-sm transform transition-transform hover:-translate-y-1">
      <div class="flex items-center gap-2">
        <span>${u.name} ${u.isHost ? '👑' : ''}</span>
        ${u.status === 'joining' ? '<span class="text-xs animate-pulse">Waiting...</span>' : ''}
      </div>
      ${me?.isHost && u.id !== conn.id ? `<button onclick="kickUser('${u.id}')" class="neo-press bg-neo-accent text-white border-2 border-black px-2 py-1 text-xs hover:bg-red-600">KICK</button>` : ''}
    </div>
  `).join('');

  const existingList = document.getElementById("lobby-users-list");
  if (existingList) {
    existingList.innerHTML = userHtml || '<p class="font-bold">Waiting for server...</p>';
    return;
  }

  output.innerHTML = `
    <div class="flex flex-col h-screen p-6 max-w-md mx-auto animate-[fadeIn_0.3s_ease-out]">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-4xl font-black uppercase tracking-tighter drop-shadow-[4px_4px_0px_#000]">LOBBY</h2>
        <button id="invite-btn" class="neo-press border-4 border-black bg-neo-muted px-4 py-2 font-black shadow-neo-sm rotate-2 hover:bg-purple-300">INVITE 🔗</button>
      </div>
      
      <div id="lobby-users-list" class="flex-1 overflow-y-auto mb-4 pr-2">${userHtml || '<p class="font-bold">Waiting for server...</p>'}</div>

      ${me?.isHost ? `
        <div class="border-4 border-black bg-white p-3 mb-4 shadow-neo-sm flex flex-col gap-3">
          <div>
            <label class="font-black uppercase block mb-1 text-xs tracking-widest text-black/60">Search Center</label>
            <div class="relative border-4 border-black shadow-neo-md overflow-hidden bg-gray-200">
              <button id="gps-btn" class="neo-press absolute top-2 right-2 z-10 bg-[#4ade80] border-4 border-black w-10 h-10 flex items-center justify-center shadow-neo-sm hover:bg-green-300 transition-all" title="Find My Location">📍</button>
              <div id="host-map" class="w-full h-40"></div>
            </div>
          </div>
          
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Time</label>
              <select id="time-limit" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="60">1 Min</option>
                <option value="300">5 Min</option>
                <option value="600" selected>10 Min</option>
              </select>
            </div>
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Radius</label>
              <select id="search-radius" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="1000">1 km</option>
                <option value="2000">2 km</option>
                <option value="5000" selected>5 km</option>
                <option value="10000">10 km</option>
              </select>
            </div>
            <div>
              <label class="font-black uppercase block mb-1 text-[10px] tracking-widest">Limit</label>
              <select id="result-limit" class="w-full border-4 border-black p-1.5 font-black bg-neo-bg uppercase outline-none focus:bg-neo-secondary cursor-pointer text-xs">
                <option value="5">5 Places</option>
                <option value="10" selected>10 Places</option>
                <option value="15">15 Places</option>
                <option value="20">20 Places</option>
              </select>
            </div>
          </div>
        </div>
        <button id="start-btn" class="neo-press w-full border-4 border-black bg-neo-accent text-white py-4 text-2xl font-black uppercase shadow-neo-md hover:bg-red-500">START SWIPING</button>
      ` : `<div class="border-4 border-black bg-neo-muted p-4 font-black text-center shadow-neo-md animate-pulse uppercase">WAITING FOR HOST...</div>`}
    </div>
  `;

  document.getElementById("invite-btn")?.addEventListener("click", showInviteModal);
  
  document.getElementById("start-btn")?.addEventListener("click", () => {
    const timeVal = (document.getElementById("time-limit") as HTMLSelectElement).value;
    const radiusVal = (document.getElementById("search-radius") as HTMLSelectElement).value;
    const limitVal = (document.getElementById("result-limit") as HTMLSelectElement).value;
    
    fetchRestaurantsAndStart(parseInt(timeVal), parseInt(radiusVal), parseInt(limitVal));
  });

  if (me?.isHost && serverState.mapsApiKey) {
    loadGoogleMaps(serverState.mapsApiKey, initGoogleMap);
  }
}

function loadGoogleMaps(apiKey: string, callback: () => void) {
  if (typeof google !== 'undefined') { callback(); return; }
  if (document.getElementById('google-maps-script')) return;
  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
  script.async = true; script.defer = true; script.onload = callback;
  document.head.appendChild(script);
}

function initGoogleMap() {
  const mapEl = document.getElementById('host-map');
  if (!mapEl || typeof google === 'undefined') return;

  const defaultLoc = { lat: 30.073083052069688, lng: 31.287159897474055 }; 
  
  googleMap = new google.maps.Map(mapEl, {
    center: defaultLoc,
    zoom: 14, 
    disableDefaultUI: true, 
    zoomControl: true,
  });

  const marker = new google.maps.Marker({
    map: googleMap,
    position: defaultLoc,
    draggable: true
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      googleMap.setCenter(coords);
      marker.setPosition(coords);
      selectedLat = coords.lat.toString();
      selectedLng = coords.lng.toString();
    });
  }

  googleMap.addListener('click', (e: any) => {
    marker.setPosition(e.latLng);
    selectedLat = e.latLng.lat();
    selectedLng = e.latLng.lng();
  });

  marker.addListener('dragend', (e: any) => {
    selectedLat = e.latLng.lat();
    selectedLng = e.latLng.lng();
  });

  document.getElementById('gps-btn')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      const btn = document.getElementById('gps-btn');
      btn?.classList.add('animate-pulse');
      
      navigator.geolocation.getCurrentPosition((pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        googleMap.setCenter(coords);
        googleMap.setZoom(15);
        marker.setPosition(coords);
        selectedLat = coords.lat.toString();
        selectedLng = coords.lng.toString();
        btn?.classList.remove('animate-pulse');
      }, () => {
        alert("Could not access GPS.");
        btn?.classList.remove('animate-pulse');
      });
    }
  });
}

function renderSwiper() {
  if (isKicked) return;
  const current = restaurants[currentIndex];
  if (!current) {
    conn.send(JSON.stringify({ type: "finished_swiping" }));
    renderWaitingDashboard();
    return;
  }
  
  output.innerHTML = `
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 border-4 border-black bg-white px-4 py-1 font-black shadow-neo-sm -rotate-2 text-xl">
      ⏱ <span id="global-timer-text">--:--</span>
    </div>
    <div class="flex flex-col h-screen p-4 pt-16 pb-8 max-w-md mx-auto relative animate-[fadeIn_0.2s_ease-out]">
      
      <div class="flex justify-between items-center mb-4 pt-2">
        <div class="border-4 border-black bg-white px-3 py-1 font-black shadow-neo-sm rotate-1">${myName}</div>
        <div class="border-4 border-black bg-neo-muted px-3 py-1 font-black shadow-neo-sm -rotate-1">${currentIndex + 1}/${restaurants.length}</div>
      </div>

      <div class="flex-1 border-4 border-black bg-white shadow-neo-lg relative flex flex-col mb-6 overflow-hidden">
        
        <!-- IMAGE CAROUSEL -->
        <div class="h-48 w-full border-b-4 border-black relative group">
          <img src="${current.images[currentImageIndex]}" class="w-full h-full object-cover" />
          
          ${current.images.length > 1 ? `
            <button id="prev-img" class="neo-press absolute left-2 top-1/2 -translate-y-1/2 bg-white border-2 border-black w-8 h-8 flex items-center justify-center font-black shadow-neo-sm text-xl hover:bg-gray-200 z-10">&lt;</button>
            <button id="next-img" class="neo-press absolute right-2 top-1/2 -translate-y-1/2 bg-white border-2 border-black w-8 h-8 flex items-center justify-center font-black shadow-neo-sm text-xl hover:bg-gray-200 z-10">&gt;</button>
            <div class="absolute top-2 left-2 bg-white border-2 border-black px-2 py-0.5 text-xs font-black shadow-neo-sm z-10">
              ${currentImageIndex + 1} / ${current.images.length}
            </div>
          ` : ''}

          <div class="absolute -bottom-4 right-4 border-4 border-black bg-neo-secondary font-black px-3 py-1 rotate-3 shadow-neo-sm z-10">${current.rating === 0 ? "NEW" : current.rating} ★</div>
        </div>

        <!-- DETAILS -->
        <div class="p-4 flex-1 flex flex-col ${current.color}">
          <div class="flex justify-between items-start mb-1">
            <p class="font-bold uppercase tracking-widest text-xs border-2 border-black inline-block px-1 bg-white">${current.type}</p>
            <span class="text-[10px] font-black uppercase bg-neo-muted border-2 border-black px-2 py-0.5 rotate-2 shadow-neo-sm">${current.distance.toFixed(1)} km away</span>
          </div>
          
          <h2 class="text-3xl font-black uppercase tracking-tighter leading-none mb-3">${current.name}</h2>
          
          <div class="bg-white border-4 border-black p-3 flex-1 flex flex-col overflow-y-auto">
            <h3 class="font-black uppercase mb-1 text-xs text-gray-500">Location</h3>
            <p class="font-bold text-sm leading-tight mb-4">${current.address}</p>
            
            <a href="${current.googleMapsUri}" target="_blank" class="neo-press border-2 border-black bg-[#60a5fa] px-3 py-2 font-black text-sm uppercase shadow-neo-sm hover:bg-blue-300 text-center mt-auto">
              Open in Google Maps ↗
            </a>
          </div>
        </div>
      </div>

      <!-- SWIPE CONTROLS -->
      <div class="grid grid-cols-2 gap-4 h-20">
        <button id="btn-no" class="neo-press border-4 border-black bg-white shadow-neo-md text-2xl font-black flex items-center justify-center hover:bg-gray-200">NO</button>
        <button id="btn-yes" class="neo-press border-4 border-black bg-neo-accent text-white shadow-neo-md text-2xl font-black flex items-center justify-center hover:bg-red-500">YES</button>
      </div>
    </div>
  `;

  // Image Navigation Listeners
  document.getElementById("prev-img")?.addEventListener("click", () => {
    currentImageIndex = (currentImageIndex - 1 + current.images.length) % current.images.length;
    renderSwiper(); // Re-render to update the image
  });

  document.getElementById("next-img")?.addEventListener("click", () => {
    currentImageIndex = (currentImageIndex + 1) % current.images.length;
    renderSwiper(); 
  });

  // Swipe Logic Listeners
  document.getElementById("btn-no")?.addEventListener("click", () => { 
    currentIndex++; 
    currentImageIndex = 0; // Reset image for next restaurant
    renderSwiper(); 
  });

  document.getElementById("btn-yes")?.addEventListener("click", () => {
    conn.send(JSON.stringify({ type: "swipe", restaurantId: current.id, direction: "right" }));
    currentIndex++; 
    currentImageIndex = 0; 
    renderSwiper();
  });
}

function renderWaitingDashboard() {
  if (isKicked) return;
  const me = serverState.users.find((u: any) => u.id === conn.id);
  const userHtml = serverState.users.map((u: any) => `
    <div class="border-4 border-black p-3 mb-3 bg-white shadow-neo-sm flex justify-between items-center">
      <span class="font-bold text-lg">${u.name}</span>
      <div class="flex items-center gap-2">
        ${u.status === 'finished' ? '<span class="bg-neo-secondary border-2 border-black px-2 font-black rotate-2 shadow-neo-sm">DONE</span>' : '<span class="animate-pulse font-bold text-neo-accent">CHOOSING...</span>'}
        ${me?.isHost && u.id !== conn.id ? `<button onclick="kickUser('${u.id}')" class="neo-press bg-neo-accent text-white border-2 border-black px-2 py-1 text-xs hover:bg-red-600">KICK</button>` : ''}
      </div>
    </div>
  `).join('');
  output.innerHTML = `
    <div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 border-4 border-black bg-white px-4 py-1 font-black shadow-neo-sm rotate-1 text-xl">
      ⏱ <span id="global-timer-text">--:--</span>
    </div>
    <div class="flex flex-col h-screen p-6 pt-16 max-w-md mx-auto animate-[fadeIn_0.3s_ease-out]">
      <h2 class="text-4xl font-black uppercase tracking-tighter mb-2">STATUS DASHBOARD</h2>
      <p class="font-bold mb-6 border-b-4 border-black pb-2">Waiting for slow friends...</p>
      <div class="flex-1 overflow-y-auto pr-2 mb-6">${userHtml}</div>
      ${me?.isHost ? `<button id="force-btn" class="neo-press w-full border-4 border-black bg-black text-white py-4 text-xl font-black uppercase shadow-neo-md hover:bg-gray-800">FORCE END ROOM NOW</button>` : `<div class="border-4 border-black bg-neo-bg p-4 font-black text-center shadow-neo-md">HOST CAN FORCE END</div>`}
    </div>
  `;
  document.getElementById("force-btn")?.addEventListener("click", () => conn.send(JSON.stringify({ type: "force_end" })));
}

function renderMatch(data: any) {
  if (isKicked) return;
  if (visualTimerInterval) clearInterval(visualTimerInterval);
  let matchedPlace;
  if (data.isNuclear) {
    matchedPlace = [...restaurants].sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating))[0];
  } else {
    matchedPlace = restaurants.find(r => r.id === data.restaurantId);
  }
  const totalUsers = serverState.users.length;
  const matchVotes = data.isNuclear ? 0 : (data.stats[matchedPlace?.id || ""]?.length || 0);
  output.innerHTML = `
    <div class="h-screen ${data.isNuclear ? 'bg-black text-neo-accent' : 'bg-neo-accent text-white'} flex flex-col items-center justify-center p-6 text-center animate-[fadeIn_0.5s_ease-out] overflow-y-auto">
      <div class="animate-bounce mt-10">
        <div class="border-4 border-black bg-white px-6 py-2 font-black text-2xl shadow-neo-md -rotate-3 mb-6 inline-block text-black">
          ${data.isNuclear ? '🔥 البس يا معلم' : data.forced ? 'FORCED DECISION' : 'TARGET ACQUIRED'}
        </div>
      </div>
      <h1 class="text-5xl font-black uppercase tracking-tighter leading-none mb-6 drop-shadow-[4px_4px_0px_#000]">${matchedPlace?.name || 'NOBODY AGREED'}</h1>
      ${matchedPlace ? `
        <div class="border-4 border-black bg-white w-full max-w-sm mb-6 shadow-neo-lg rotate-1 overflow-hidden text-black text-left">
           <div class="h-40 w-full border-b-4 border-black relative">
             <img src="${matchedPlace.images[0]}" class="w-full h-full object-cover grayscale ${data.isNuclear ? 'contrast-200' : ''}" />
             ${data.isNuclear ? `<div class="absolute inset-0 bg-red-500/30 mix-blend-multiply"></div>` : ''}
           </div>
           <div class="p-4 bg-neo-secondary">
             <p class="font-black text-xl mb-1">${data.isNuclear ? 'YOUR PUNISHMENT:' : 'FINAL STATS:'}</p>
             <p class="font-bold text-md mb-4">${data.isNuclear ? 'You took too long. Enjoy the low-rated food.' : `${matchVotes} out of ${totalUsers} friends swiped YES.`}</p>
             <a href="${matchedPlace.googleMapsUri}" target="_blank" class="neo-press block w-full border-2 border-black bg-[#60a5fa] px-3 py-3 font-black text-sm uppercase shadow-neo-sm hover:bg-blue-300 text-center">
              Open in Google Maps ↗
            </a>
           </div>
        </div>
      ` : ''}
      <button onclick="window.location.href='/'" class="neo-press border-4 border-black bg-white text-black px-8 py-4 font-black text-xl shadow-neo-md hover:bg-gray-200 mb-10">START OVER</button>
    </div>
  `;
}

function renderKicked() {
  isKicked = true;
  if (visualTimerInterval) clearInterval(visualTimerInterval);
  output.innerHTML = `
    <div class="h-screen bg-black flex flex-col items-center justify-center p-6 text-center animate-[fadeIn_0.2s_ease-out]">
      <h1 class="text-6xl text-neo-accent font-black uppercase tracking-tighter mb-6">BOOTED.</h1>
      <p class="text-white text-xl font-bold mb-8">The host removed you from the lobby.</p>
      <button onclick="window.location.href='/'" class="neo-press border-4 border-black bg-white text-black px-8 py-4 font-black shadow-[4px_4px_0px_0px_#FF6B6B] hover:bg-gray-200">GO HOME</button>
    </div>
  `;
}

(window as any).kickUser = (userId: string) => { conn.send(JSON.stringify({ type: "kick", userId })); };

conn.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "kicked") { renderKicked(); conn.close(); return; }
  
  if (data.type === "sync") {
    const wasLobby = serverState.state === 'lobby';
    serverState = data;

    if (serverState.restaurants && serverState.restaurants.length > 0) {
      restaurants = serverState.restaurants;
    }
    
    if (serverState.state === 'lobby' && myName !== "") renderLobby();
    if (serverState.state === 'swiping') {
      if (wasLobby) startVisualTimer();
      // Ensure we render correctly if joining late or just transitioning
      if (currentIndex < restaurants.length) renderSwiper();
      else renderWaitingDashboard();
    }
  }
  if (data.type === "match") renderMatch(data);
});

renderLogin();