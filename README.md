# Simpler, Game-Jam-Vibes README

# 🔥🍗 Chicken Tender

A goofy little web app I made because my friends and I CANNOT pick a restaurant.

You know the group chat. *"idk where do you wanna eat?"* *"i'm down for whatever"* *"no not there"* *"too far"* *"too expensive"*. Forty-five minutes later, everyone's hangry. So I built this.

---

## The idea

One person makes a room, sends the link, everyone hops on their phone. The app pulls 20 nearby restaurants and you all swipe like Tinder. YES or NO.

But here's the twist 🔥

**If you can't agree before the timer runs out, the app NUKES YOU.** It picks the worst-rated place on the list and that's where you're going. No takebacks. The Nuclear Option.

It's funny because it works. The threat of a 2-star Burger King makes people decisive REAL fast.

---

## Try it

1. Clone the repo
2. `npm install`
3. Make a `.env` file:
   ```
   RAPID_API_KEY=your_key_here
   MAPS_API_KEY=your_key_here
   ```
   - RapidAPI key: subscribe to [Google Map Places New V2](https://rapidapi.com/letscrape-6bRBa3QguO5/api/google-map-places-new-v2) (free tier is fine)
   - Google Maps key: just enable the Maps JS API
4. `npx partykit dev`
5. Open `http://localhost:1999`

To play with friends on your wifi, give them your laptop's local IP instead of localhost (something like `192.168.1.42:1999`).

To put it on the internet for real:
```bash
npx partykit deploy
```

---

## Stack

- **PartyKit** for the realtime stuff (websockets, rooms, all of it)
- **TypeScript** because I like red squiggles
- **Tailwind CDN** because configuring tailwind is the worst part of any project
- **Google Places via RapidAPI** for restaurant data + photos

photos are pulled with a sneaky trick (Thanks to the random linkedin post) Google has a public "report this image" page that embeds the photo, so I scrape that on the server instead of paying for the official Photo endpoint. probably against ToS lol but it's a hackathon project so 🤷

---

## How to play

**You (the host):**
- pick where to search on the map
- set a timer (1 min if you're brave, 10 min if you're sane)
- send the invite link
- start swiping

**Your friends:**
- click the link
- type their name
- swipe
- pray

**The app:**
- counts everyone's YES votes
- when everyone's done, picks whatever got the most votes
- OR if the timer dies first... 🔥🍗🔥

---

## Stuff it does

- 🗺️ map picker so the host doesn't have to type an address
- 📸 photo carousels for each place + tap-to-fullscreen
- ⏱️ a stress-inducing countdown
- 👑 host can kick people who are being weird
- 📊 end-of-game stats showing who voted for what (for the post-meal arguments)
- 💀 the actual Nuclear Option, which is the whole point

---

## Stuff it doesn't do (yet?)

- swipe with your finger on the actual card (right now it's just buttons, sorry)
- food filters
- a "JOHN swiped NO on everything" award screen which would be SO funny

---

## Known issues

- the free RapidAPI tier is like 100 requests a month, so don't go crazy
- photos are kinda low-res (like 600px) because of the scraping trick
- if you join after swiping started you start from card 1, which is a little weird
- when the host leaves the room, the room is lost... forever

---
*made for everyone who has ever typed "i'm fine with anything" and meant it as a threat*