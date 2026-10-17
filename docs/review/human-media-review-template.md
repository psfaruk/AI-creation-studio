# মানব-মিডিয়া-পর্যালোচনা টেমপ্লেট / Human Media-Review Template

**D-9/B7 — durable human review workflow.**
এই টেমপ্লেটটি AI Creation Studio-র জেনারেট করা প্রতিটি আর্টিফ্যাক্ট
(ভিডিও/অডিও/চলচ্চিত্র) মানুষের চোখে-কানে পর্যালোচনা করার স্থায়ী ফরম্যাট।
This is the durable format for reviewing every generated artifact (video /
audio / film) with a real human's eyes and ears.

---

## 🔴 অমোঘ নিয়ম / Non-negotiable rule

> **মানব-পর্যালোচনা ছাড়া কোনো ফলাফল বানানো নিষিদ্ধ — NOT_REVIEWED-ই ডিফল্ট।**
>
> **Fabricating a review outcome without a real human review is forbidden —
> NOT_REVIEWED is the default.**

- জেনারেট করা আর্টিফ্যাক্টের পর্যালোচনা শুরু হয় **NOT_REVIEWED** দিয়ে।
- reviewer-এর নাম, তারিখ বা রায় (PASS/PASS_WITH_LIMITATIONS/FAIL)
  কখনো বানানো/অনুমান/ডিফল্ট-ভরাট হয় না।
- কেবল একজন **প্রকৃত মানুষ** মিডিয়াটি দেখে/শুনে রায় দিলে সেটি বদলায়।
- রায় দাবি করা রেকর্ডে reviewer-নাম ও তারিখ বাধ্য — প্রমাণ ছাড়া রায়
  `validateReviewRecord()` দিয়ে যাচাইই হয় না।

---

## ফলাফল-প্রমাণ ক্ষেত্র / Evidence fields

| ক্ষেত্র / Field | আবশ্যক? | বিবরণ / Meaning |
|---|---|---|
| `artifactId` | আবশ্যক / required | যে আর্টিফ্যাক্ট-রো (Artifact.id) পর্যালোচনা হচ্ছে |
| `productionId` | ঐচ্ছিক / optional | সংশ্লিষ্ট প্রোডাকশন (Production.id), থাকলে |
| `reviewer` | আবশ্যক / required | প্রকৃত পর্যালোচকের নাম — কখনো ফাঁকা বা বানানো নয় |
| `reviewedAt` | আবশ্যক / required | পর্যালোচনার তারিখ (ISO 8601, যেমন `2026-10-18T14:30:00+06:00`) |
| `dimensions` | আবশ্যক / required | নিচের ১৩টি মাত্রিকের প্রতিটির অবস্থা + ঐচ্ছিক নোট — **১৩টির সবগুলোই থাকতে হবে** (না দেখলে `NOT_REVIEWED` লিখুন, কী-ই বাদ দেবেন না) |
| `overallStatus` | আবশ্যক / required | সামগ্রিক রায় — ৪টির একটি |
| `blockerNote` | ঐচ্ছিক / optional | FAIL/PWL-এর কারণ, ব্লকার বর্ণনা |
| মিডিয়া-লিংক / media links | আবশ্যক / required | আর্টিফ্যাক্ট ফাইলের লিংক (`/api/artifacts/<id>/file`) + যে প্লেয়ারে দেখা হলো |

---

## ১৩টি মাত্রিক / The 13 dimensions

প্রতিটি মাত্রিকে কী কী দেখতে হবে / what to check for each dimension:

| # | মাত্রিক / Dimension | কী দেখবেন / What to check |
|---|---|---|
| ১ | `character_identity` — চরিত্র-পরিচয় | একই চরিত্র কি সব শটে একই মুখ, পোশাক, চুল, কণ্ঠস্বর বহন করছে? শট বদলালেও পরিচয় ভাঙছে কি না — যেকোনো ক্যারেক্টার-রেফারেন্স আর্টিফ্যাক্টের সাথে মিলিয়ে দেখুন। |
| ২ | `face_stability` — মুখের স্থিরতা | একটি শটের ভেতরে মুখ কি ফ্রেমে-ফ্রেমে রূপান্তরিত (morph) বা বিকৃত হচ্ছে? ক্যামেরা ঘোরার সময় মুখ গলে যাচ্ছে কি না। |
| ৩ | `facial_expressions` — মুখের অভিব্যক্তি | অভিব্যক্তি কি সংলাপ/আবেগের সাথে মেলে? অতিরিক্ত গতিশীলতা (hyper-animation) বা মৃত-মুখ (dead face) আছে কি না। |
| ৪ | `body_hand_movement` — দেহ ও হাতের নড়াচড়া | হাত-পা সংখ্যা/গঠন সঠিক কি না (আঙুল গলে যাওয়া/বাড়তি আঙুল), চলাফেরা প্রাকৃতিক কি না, অঙ্গ কি অস্বাভাবিক ভাঁজ হচ্ছে। |
| ৫ | `camera_composition` — ক্যামেরা-গঠন | ফ্রেমিং, দিগন্তরেখা (horizon) সোজা কি না, প্রধান বিষয় কেটে গেছে কি না, পরিকল্পিত শট-টাইপ (wide/close-up) কি ফলাফলে এসেছে। |
| ৬ | `temporal_consistency_flicker` — সময়গত সঙ্গতি ও ফ্লিকার | ফ্রেমে-ফ্রেমে আলো/রং/বস্তু ঝিলিক (flicker) করছে কি না; বস্তু হঠাৎ বদলে যাচ্ছে বা অদৃশ্য হচ্ছে কি না। |
| ৭ | `scene_continuity` — দৃশ্য-ধারাবাহিকতা | কাটের আগে-পরে পটভূমি, প্রপ, আলো, পোশাক, সময়-of-day একই থাকছে কি না। |
| ৮ | `lipsync_alignment` — ঠোঁট-সমলয় | মুখের নড়াচড়া কি উচ্চারিত শব্দের তালে তালে চলছে? ঠোঁট আগে/পরে চলছে, বা কথা না বলতেও মুখ নড়ছে কি না। |
| ৯ | `pronunciation_intelligibility` — উচ্চারণ-স্পষ্টতা | বাংলা উচ্চারণ সঠিক ও বোধগম্য কি না; শব্দ কাটা/ভাঙা/অস্পষ্ট কি না; ভুল বিদেশি উচ্চারণ আছে কি না। |
| ১০ | `music_speech_balance` — সংগীত-কথা ভারসাম্য | ব্যাকগ্রাউন্ড সংগীত কি সংলাপ/গান ডুবিয়ে দিচ্ছে? মিশ্রণে কথার স্পষ্টতা বজায় আছে কি না। |
| ১১ | `subtitle_correctness` — সাবটাইটেল-শুদ্ধতা | সাবটাইটেল কি বলা কথার হুবহু/অর্থবহ বাংলা ট্রান্সক্রিপ্ট? বানান ভুল, সময়-ভুল, পুরনো সাবটাইটেল আছে কি না। |
| ১২ | `av_synchronization` — দৃশ্য-শব্দ সমলয় | অডিও আর ভিডিও কি একসাথে চলছে (drift নেই)? শব্দ-ইফেক্ট দৃশ্যের মুহূর্তের সাথে মেলে কি না। |
| ১৩ | `overall_realism` — সামগ্রিক বাস্তবতা | uncanny-valley ত্রুটি, অস্বাভাবিক রং/টেক্সচার, পদার্থবিদ্যা-ভাঙা গতি — সামগ্রিকভাবে দর্শকের চোখে বিশ্বাসযোগ্য কি না। |

---

## ৪টি অবস্থা / The 4 statuses

| অবস্থা / Status | বাংলা লেবেল | সংজ্ঞা / Definition |
|---|---|---|
| `NOT_REVIEWED` | পর্যালোচিত হয়নি | এই মাত্রিকে এখনো কোনো মানুষ দেখেনি — **একমাত্র সৎ ডিফল্ট**। রায় বলা যাবে না। |
| `PASS` | উত্তীর্ণ | মানদণ্ড পূরণ করেছে; উল্লেখযোগ্য সমস্যা নেই। |
| `PASS_WITH_LIMITATIONS` | সীমাবদ্ধতাসহ উত্তীর্ণ | ব্যবহারযোগ্য, কিন্তু সীমাবদ্ধতা আছে — নোটে সেটি লিখতেই হবে। |
| `FAIL` | অনুত্তীর্ণ | ব্লকিং ত্রুটি — এই অবস্থায় আর্টিফ্যাক্ট ব্যবহার/প্রকাশ করা যাবে না; নোট বা blockerNote-এ কারণ বাধ্য। |

**সারাংশ-নিয়ম (aggregate honesty):** যেকোনো মাত্রিক `FAIL` → সারাংশ `FAIL`;
না হলে কোনো `PASS_WITH_LIMITATIONS` → সারাংশ `PASS_WITH_LIMITATIONS`; না হলে
কোনো `PASS` → `PASS`; সবই `NOT_REVIEWED` → সারাংশ `NOT_REVIEWED`। আংশিক-
পর্যালোচিত রেকর্ডে সারাংশ কেবল দেখা-হয়েছে-এমন মাত্রিকের উপর দাঁড়ায়,
এবং অ-পর্যালোচিত মাত্রিকের ফাঁক আলাদাভাবে (`hasUnreviewedDimensions`) প্রকাশ পায়।

---

## পূরণ-করার টেমপ্লেট / Fill-in template

একটি রেকর্ড ফাইল/JSON-এ সংরক্ষণ করার আগে নিচের খসড়াটি পূরণ করুন এবং
`src/lib/agent/review/human-media-review.ts`-এর `validateReviewRecord()` দিয়ে
যাচাই করুন। Copy this block, fill it in honestly, and validate before storing.

```markdown
### পর্যালোচনা-রেকর্ড / Review record

- artifactId: <Artifact.id — আবশ্যক>
- productionId: <Production.id — থাকলে, না থাকলে লাইনটি বাদ>
- reviewer: <প্রকৃত পর্যালোচকের নাম — আবশ্যক, কখনো বানানো নয়>
- reviewedAt: <ISO-8601 তারিখ-সময় — আবশ্যক>
- media link: <আর্টিফ্যাক্ট-ফাইলের লিংক /api/artifacts/<id>/file + প্লেয়ার>

| মাত্রিক | অবস্থা | নোট (প্রমাণ/পর্যবেক্ষণ) |
|---|---|---|
| character_identity | <NOT_REVIEWED/PASS/PASS_WITH_LIMITATIONS/FAIL> | <দেখলে কী দেখলেন, না দেখলে খালি> |
| face_stability | <…> | <…> |
| facial_expressions | <…> | <…> |
| body_hand_movement | <…> | <…> |
| camera_composition | <…> | <…> |
| temporal_consistency_flicker | <…> | <…> |
| scene_continuity | <…> | <…> |
| lipsync_alignment | <…> | <…> |
| pronunciation_intelligibility | <…> | <…> |
| music_speech_balance | <…> | <…> |
| subtitle_correctness | <…> | <…> |
| av_synchronization | <…> | <…> |
| overall_realism | <…> | <…> |

- overallStatus: <NOT_REVIEWED/PASS/PASS_WITH_LIMITATIONS/FAIL — সামগ্রিক রায়>
- blockerNote: <FAIL/PWL হলে কারণ — ঐচ্ছিক কিন্তু প্রত্যাশিত>
```

### সৎ-পূরণের নির্দেশনা / Honesty guidelines

1. **যা দেখেননি, সেটি `NOT_REVIEWED`-ই থাকুক** — অতীত অভিজ্ঞতা বা "নিশ্চয়ই
   ঠিক হবে" ভেবে রায় দেবেন না।
2. প্রতিটি PASS/PWL/FAIL-এ **নোটে প্রত্যক্ষ প্রমাণ** লিখুন (কোন মুহূর্তে/
   শটে কী দেখলেন — যেমন "শট ৩-এ বাঁ হাতের আঙুল ছয়টি")।
3. `PASS_WITH_LIMITATIONS` ব্যবহার করলে সীমাবদ্ধতা নোটে **বাধ্য**।
4. `FAIL` দিলে কোন মাত্রিক ব্লক করলো তা স্পষ্ট করুন; দরকারে `blockerNote` ব্যবহার করুন।
5. রেকর্ডটি পূর্ণাঙ্গ না হলে আংশিক রেকর্ড *সংরক্ষণ* করা যাবে, কিন্তু
   সারাংশ কখনো "সম্পূর্ণ পাস" দাবি করবে না — `hasUnreviewedDimensions`
   ফাঁকটি প্রকাশ করবে।
6. reviewer-নাম বা তারিখ কখনো ফাঁকা/বানানো রাখা যাবে না — রায়-দাবি
   রেকর্ড বৈধই হবে না।

---

*সংশ্লিষ্ট কোড: `src/lib/agent/review/human-media-review.ts` (মডিউল),
`tests/regression/t24-human-media-review.test.ts` (REG-24 লক)।*
