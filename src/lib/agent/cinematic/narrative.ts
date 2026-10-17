// ============================================================
// Narrative sequence review — latest-fix Phase 3 (§3.2)।
//
// কেন: parseAndValidateShotPlan কাঠামোগত সত্য যাচাই করে (আইডি/ক্রম/
// এনাম/দৈর্ঘ্য-যোগফল) — কিন্তু মাস্টার-প্রম্পট §3.2 চায় *ন্যারেটিভ*
// সম্পর্কের যাচাই: এস্টাব্লিশিং-শট আগে এসেছে কি না, একই দৃশ্যের শট
// ধারাবাহিক কি না, প্রতিক্রিয়ার আগে কর্ম-শট আছে কি না, চরিত্র অযৌক্তিক
// জায়গায় ঢুকছে কি না।
//
// নীতি (§3.2-এর শেষ বাক্য): "শটগুলোর semantic relationship না মিললে
// warning বা review flag তৈরি করো" — এটি **সতর্কতা-জেনারেটর**, ব্লকার নয়।
// নির্ধারক পরিকল্পক নিজ-আর্ক-নিয়মে বেশিরভাগ ক্ষেত্রেই ঠিক পরিকল্পনা
// বানায়; এই পর্যালোচনা LLM/ওভাররাইড/পুনঃপঠিত পরিকল্পনার জন্য
// সুরক্ষা-জাল এবং ব্যবহারকারীর প্রিভিউতে সৎ পর্যালোচনা-পতাকা।
//
// সততা: এখানে কোনো "emotional continuity" দাবি নেই — যা ডেটা আছে
// (subject/size/scene/character/duration/notes) শুধু তারই যাচাই। কাপড়/
// পোশাক-সামঞ্জস্যের মতো দৃশ্যমান-বিষয়ের যাচাই এই স্তরে অসম্ভব —
// সেটি মানব-রিভিউয়ের (§3.4) দায়িত্ব, নোটে সৎভাবে বলা হয়।
// ============================================================

import type { CinematicPlan, CinematicShot } from './types';

export type NarrativeWarningCode =
  | 'OPENING_NOT_ESTABLISHING'
  | 'SCENE_INTERLEAVED'
  | 'REACTION_BEFORE_ACTION'
  | 'VERY_SHORT_SHOT_CHAIN'
  | 'SCENE_BOUNDARY_WITHOUT_NOTE';

export interface NarrativeWarning {
  code: NarrativeWarningCode;
  shotId?: string;
  sceneId?: string;
  messageBn: string;
}

export interface NarrativeReview {
  warnings: NarrativeWarning[];
  checkedShots: number;
  /** পর্যালোচনার সৎ সীমা — প্রিভিউ-UI-তে দেখানো হয় */
  scopeNoteBn: string;
}

/** subject-শ্রেণি: কর্ম/পারফরম্যান্স (প্রতিক্রিয়ার পূর্বসূরি হতে পারে)।
 *  environment নয় — পরিবেশ-শট কোনো কর্ম দেখায় না, "কীসের প্রতিক্রিয়া"
 *  প্রশ্নটি থেকে যায়। */
const ACTION_SUBJECTS: readonly string[] = ['scene', 'artist_performance'];

/**
 * §3.২ — ন্যারেটিভ-ক্রমের পর্যালোচনা। পরিকল্পনা বৈধ (কাঠামোগত) ধরে
 * নেওয়া হয় — parseAndValidateShotPlan পরে ডাকুন।
 */
export function reviewNarrative(plan: CinematicPlan): NarrativeReview {
  const warnings: NarrativeWarning[] = [];
  const shots = plan.shots;
  const sceneById = new Map(plan.scenes.map(s => [s.sceneId, s]));

  // ---- ১. সূচনা-শট এস্টাব্লিশিং/ওয়াইড কি না (MV-প্রথা; শর্টফিল্মের
  //         প্রথম দৃশ্যেও ভৌগোলিক অভিমুখ প্রত্যাশিত) ----
  if (shots.length > 0) {
    const first = shots[0];
    if (first.size !== 'establishing_wide' && first.size !== 'wide') {
      warnings.push({
        code: 'OPENING_NOT_ESTABLISHING',
        shotId: first.shotId,
        messageBn: `সূচনা-শট (${first.labelBn || first.shotId}) এস্টাব্লিশিং/ওয়াইড নয় ("${first.size}") — দর্শক দৃশ্যের ভৌগোলিক অভিমুখ ছাড়াই গল্পে ঢোকে; ন্যারেটিভ-প্রথা ভেঙে যেতে পারে।`,
      });
    }
  }

  // ---- ২. একই দৃশ্যের শট ধারাবাহিক (অ-বিন্যস্ত A,B,A) ----
  const sceneLabel = (sid: string): string =>
    sceneById.get(sid)?.purpose ?? sid;
  const lastSeen: Map<string, number> = new Map();
  const reportedScenes = new Set<string>();
  shots.forEach((shot, i) => {
    const prevScene = lastSeen.get(shot.sceneId);
    if (prevScene !== undefined && i - prevScene > 1 && !reportedScenes.has(shot.sceneId)) {
      const otherSceneIds = new Set(
        shots.slice(prevScene + 1, i).map(s => s.sceneId).filter(sid => sid !== shot.sceneId)
      );
      warnings.push({
        code: 'SCENE_INTERLEAVED',
        shotId: shot.shotId,
        sceneId: shot.sceneId,
        messageBn: `দৃশ্য "${sceneLabel(shot.sceneId)}"-এর শট ${shot.shotId} মাঝখানে অন্য দৃশ্যের ([${[...otherSceneIds].join(', ')}]) শট ঢুকে বিভাজিত — কাট-ক্রম অ-ধারাবাহিক (continuity ভাঙার ঝুঁকি)।`,
      });
      reportedScenes.add(shot.sceneId);
    }
    lastSeen.set(shot.sceneId, i);
  });

  // ---- ৩. প্রতিক্রিয়া-শটের আগে কর্ম-শট (একই দৃশ্যে) ----
  const actionSeenInScene = new Set<string>();
  for (const shot of shots) {
    if (shot.subject === 'reaction' && !actionSeenInScene.has(shot.sceneId)) {
      warnings.push({
        code: 'REACTION_BEFORE_ACTION',
        shotId: shot.shotId,
        sceneId: shot.sceneId,
        messageBn: `প্রতিক্রিয়া-শট ${shot.shotId} এসেছে কিন্তু এই দৃশ্যে তার আগে কোনো কর্ম/পারফরম্যান্স-শট নেই — "কীসের প্রতিক্রিয়া" তা দর্শকের কাছে অস্পষ্ট।`,
      });
    }
    if (ACTION_SUBJECTS.includes(shot.subject)) actionSeenInScene.add(shot.sceneId);
  }

  // ---- ৪. (§3.3-সৎ-সীমা) দৃশ্য-কাস্ট-তালিকার অনুপস্থিতি ----
  // পরিকল্পনা-ডেটা-মডেলে দৃশ্য-স্তরের চরিত্র-তালিকা নেই (চরিত্র কেবল
  // প্রতি-শট রেফারেন্স) — তাই "চরিত্র দৃশ্যে নেই কি না"-র সদস্যপদ-যাচাই
  // সংজ্ঞাগতভাবে অসম্ভব; scope-নোটে সৎভাবে বলা হয়। দৃশ্য-সীমান্ত-পারাপার
  // (নিচের ৬) চরিত্র-ধারাবাহিকতার যা ডেটা আছে তার যাচাই বহন করে।

  // ---- ৫. খুব-ছোট শটের শৃঙ্খল (কাট-ঝাঁকুনি) ----
  let shortChainStart = -1;
  shots.forEach((shot, i) => {
    const short = shot.targetDurationSec < 1.0;
    if (short) {
      if (shortChainStart < 0) shortChainStart = i;
      const chainLen = i - shortChainStart + 1;
      if (chainLen === 3) {
        warnings.push({
          code: 'VERY_SHORT_SHOT_CHAIN',
          shotId: shot.shotId,
          messageBn: `পরপর ${chainLen}+টি শট <১ সেকেন্ড (শুরু ${shots[shortChainStart].shotId} থেকে) — দ্রুত কাট-ঝাঁকুনি, দর্শকের পক্ষে পড়া কঠিন হতে পারে।`,
        });
      }
    } else {
      shortChainStart = -1;
    }
  });

  // ---- ৬. দৃশ্য-সীমান্ত পেরোনো চরিত্র — ধারাবাহিকতা-নোট ছাড়া ----
  //         (একই চরিত্র পূর্ববর্তী শটে অন্য দৃশ্যে ছিল; নোট/রূপান্তর-ইচ্ছা
  //         কিছুই নেই — §3.3-এর চরিত্র-ধারাবাহিকতার সৎ সতর্কতা)
  const prevShotByCharacter = new Map<string, CinematicShot>();
  for (const shot of shots) {
    if (!shot.character) continue;
    const prev = prevShotByCharacter.get(shot.character);
    if (prev && prev.sceneId !== shot.sceneId && !shot.continuityNote && !shot.transitionIn) {
      warnings.push({
        code: 'SCENE_BOUNDARY_WITHOUT_NOTE',
        shotId: shot.shotId,
        sceneId: shot.sceneId,
        messageBn: `চরিত্র "${shot.character}" দৃশ্য বদলেছে (${prev.shotId} → ${shot.shotId}) কিন্তু কোনো ধারাবাহিকতা/রূপান্তর-নোট নেই — পোশাক/পরিবেশ-সামঞ্জস্য নিশ্চিত করতে মানব-রিভিউ দরকার।`,
      });
    }
    prevShotByCharacter.set(shot.character, shot);
  }

  return {
    warnings,
    checkedShots: shots.length,
    scopeNoteBn:
      'ন্যারেটিভ-পর্যালোচনা: কাঠামোগত ডেটার (শট-ধরন/দৃশ্য/চরিত্র-রেফারেন্স/দৈর্ঘ্য) সম্পর্ক-যাচাই। দৃশ্য-কাস্ট-তালিকা পরিকল্পনায় নেই বলে "চরিত্র কোন দৃশ্যে আছে"-র সদস্যপদ-যাচাই এখানে অসম্ভব; দৃশ্যমান পোশাক/পরিবেশ/আলোর মানব-যাচাই এর বাইরে (মানব-রিভিউ প্রবাহ দেখুন)।',
  };
}
