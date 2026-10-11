// ============================================================
// Pipeline registry — প্রকারভেদে পাইপলাইন সংযোগ।
// pipelines/{image,audio,motion_video,music_video,short_film}.ts
// ============================================================

import type { ProductionType } from '@/lib/types';
import type { PipelineFn } from '../runner';
import { imagePipeline } from './image';
import { audioPipeline } from './audio';
import { motionVideoPipeline } from './motion_video';
import { musicVideoPipeline } from './music_video';
import { shortFilmPipeline } from './short_film';

export const PIPELINES: Record<ProductionType, PipelineFn> = {
  image: imagePipeline,
  audio: audioPipeline,
  motion_video: motionVideoPipeline,
  music_video: musicVideoPipeline,
  short_film: shortFilmPipeline,
};
