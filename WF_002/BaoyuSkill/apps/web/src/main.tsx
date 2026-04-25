/// <reference types="vite/client" />
﻿import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Provider = "google" | "openai" | "dashscope" | "replicate" | "kie";
type JobStatus = "queued" | "running" | "succeeded" | "failed";

type ProjectData = {
  version: 1;
  contentType: string;
  visualStyle: string;
  layout: string;
  palette: string;
  customColor: string;
  topic: string;
  audience: string;
  keyMessage: string;
  visibleText: string;
  scene: string;
  avoid: string;
  aspectRatio: string;
  quality: string;
  __wf002Billing?: WorkflowBillingMeta;
};

type ConfigResponse = {
  aspectRatios: string[];
  qualities: Array<"normal" | "2k">;
};

type GenerationJob = {
  id: string;
  status: JobStatus;
  prompt: string;
  provider: Provider;
  model: string | null;
  aspectRatio: string | null;
  quality: string | null;
  projectData: ProjectData | null;
  outputUrl: string | null;
  attempts: number;
  error: string | null;
  createdAt?: string;
};

type CreateGenerationResponse = {
  jobId: string;
  job: GenerationJob;
};

type HistoryResponse = {
  jobs: GenerationJob[];
};

type Option = {
  value: string;
  label: string;
  prompt: string;
};

type CaseStudy = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  templateData: ProjectData;
};

type CreativeInspiration = {
  id: string;
  title: string;
  description: string;
  tip: string;
  templateData: ProjectData;
};

type SmartRecommendation = {
  style: string;
  layout: string;
  palette: string;
  aspectRatio: string;
  quality: string;
  reason: string;
  tips: string[];
};

type WorkflowRegisterResponse = {
  run_id: string;
  register_status: string;
  estimated_count: number;
  estimated_frozen_points: number;
};

type WorkflowBillingMeta = {
  workflowCode: "WF-002";
  runId: string;
  clientRequestId: string;
  estimatedFrozenPoints: number;
};

const AUTH_TOKEN_KEY = "auth_demo_token";
const BRAND_ASSET_VERSION = "20260425b";
const APP_BASE = import.meta.env.BASE_URL;

function toAppPath(path: string) {
  return `${APP_BASE}${path.replace(/^\/+/, "")}`;
}

function resolveAuthApiBase() {
  const { protocol, hostname, port } = window.location;
  const normalizedHost = String(hostname || "").toLowerCase();

  if (protocol === "file:") {
    return "http://127.0.0.1:3002";
  }

  if (
    port === "5173" ||
    port === "3003" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "0.0.0.0"
  ) {
    return `${protocol}//${hostname || "127.0.0.1"}:3002`;
  }

  return window.location.origin;
}

function resolveAuthEntryUrl() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:8080/auth/?mode=login";
  }

  if (port === "5173" || port === "3003") {
    return `${protocol}//${hostname || "127.0.0.1"}:8080/auth/?mode=login`;
  }

  return `${window.location.origin}/auth/?mode=login`;
}

function readAuthToken() {
  const currentUrl = new URL(window.location.href);
  const tokenFromQuery = currentUrl.searchParams.get("token")?.trim() || "";
  if (tokenFromQuery) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, tokenFromQuery);
    currentUrl.searchParams.delete("token");
    window.history.replaceState(null, "", currentUrl.toString());
    return tokenFromQuery;
  }

  return window.localStorage.getItem(AUTH_TOKEN_KEY)?.trim() || "";
}

function redirectToLogin() {
  const loginUrl = new URL(resolveAuthEntryUrl(), window.location.origin);
  loginUrl.searchParams.set("redirect", window.location.href);
  window.location.replace(loginUrl.toString());
}

function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verifyLogin() {
      const token = readAuthToken();
      if (!token) {
        redirectToLogin();
        return;
      }

      const authApiBase = resolveAuthApiBase();
      const meUrl = authApiBase ? `${authApiBase}/me` : "/me";

      try {
        const response = await fetch(meUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Auth check failed with status ${response.status}`);
        }

        if (!cancelled) {
          setReady(true);
        }
      } catch {
        window.localStorage.removeItem(AUTH_TOKEN_KEY);
        if (!cancelled) {
          redirectToLogin();
        }
      }
    }

    void verifyLogin();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <main style={{ padding: "24px" }}>Checking login status...</main>;
  }

  return <>{children}</>;
}

function buildClientRequestId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `wf002_baoyu_${Date.now()}_${random}`;
}

function toAbsoluteResultUrl(outputUrl: string | null) {
  if (!outputUrl) return null;
  if (/^https?:\/\//i.test(outputUrl)) return outputUrl;
  return `${window.location.origin}${toAppPath(outputUrl)}`;
}

function getBillingMeta(projectData: ProjectData | null): WorkflowBillingMeta | null {
  if (!projectData || typeof projectData !== "object") return null;
  const raw = (projectData as { __wf002Billing?: unknown }).__wf002Billing;
  if (!raw || typeof raw !== "object") return null;

  const candidate = raw as Record<string, unknown>;
  if (
    candidate.workflowCode === "WF-002" &&
    typeof candidate.runId === "string" &&
    candidate.runId.trim() &&
    typeof candidate.clientRequestId === "string" &&
    candidate.clientRequestId.trim()
  ) {
    return {
      workflowCode: "WF-002",
      runId: candidate.runId.trim(),
      clientRequestId: candidate.clientRequestId.trim(),
      estimatedFrozenPoints: Number(candidate.estimatedFrozenPoints ?? 0),
    };
  }

  return null;
}

const statusLabels: Record<JobStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
};

const contentTypes: Option[] = [
  { value: "xiaohongshu-cover", label: "小红书封面", prompt: "适合小红书封面的竖版视觉，标题醒目，信息有层次，适合社交媒体浏览" },
  { value: "knowledge-card", label: "知识卡片", prompt: "知识卡片设计，重点清晰，结构化排版，适合收藏和转发" },
  { value: "quote-poster", label: "金句海报", prompt: "金句海报设计，文字有情绪张力，画面留白充足，适合传播" },
  { value: "tutorial", label: "步骤教程图", prompt: "步骤教程信息图，步骤编号清楚，阅读路径明确，易于照着执行" },
  { value: "product-card", label: "产品卖点图", prompt: "产品卖点图，突出核心价值和使用场景，视觉干净专业" },
  { value: "comparison", label: "对比分析图", prompt: "对比分析信息图，左右或分区对照，差异一眼可读" },
];

const styleOptions: Option[] = [
  { value: "fresh", label: "清新", prompt: "清新明亮，轻盈自然，低噪点，高级感" },
  { value: "cute", label: "可爱", prompt: "可爱亲和，圆润图形，轻松活泼但不过度幼稚" },
  { value: "minimal", label: "极简", prompt: "极简设计，克制留白，少量元素，高级排版" },
  { value: "bold", label: "大胆", prompt: "高对比，大标题，强视觉冲击，适合快速吸引注意" },
  { value: "handdrawn", label: "手绘笔记", prompt: "手绘笔记风格，轻微纸张质感，标注、箭头和小插画自然融合" },
  { value: "retro", label: "复古", prompt: "复古平面设计，怀旧质感，字体和构图有年代感" },
  { value: "notion", label: "Notion 风", prompt: "Notion 风格，模块化信息块，干净理性，轻量图标点缀" },
  { value: "blackboard", label: "黑板风", prompt: "黑板板书风格，粉笔质感，像课堂重点总结" },
];

const layoutOptions: Option[] = [
  { value: "balanced", label: "均衡", prompt: "均衡布局，主视觉、标题和说明文字比例协调" },
  { value: "sparse", label: "留白", prompt: "大量留白，中心信息突出，画面呼吸感强" },
  { value: "dense", label: "密集", prompt: "信息密度较高但不拥挤，分组清晰，适合知识总结" },
  { value: "list", label: "列表", prompt: "列表式布局，条目对齐，重点用编号或图标区分" },
  { value: "contrast", label: "对比", prompt: "对比式布局，左右或上下分区，差异关系明确" },
  { value: "flow", label: "流程", prompt: "流程式布局，用箭头、步骤和路径引导阅读顺序" },
];

const paletteOptions: Option[] = [
  { value: "auto", label: "自动配色", prompt: "根据主题自动选择协调配色，避免杂乱" },
  { value: "pastel", label: "马卡龙", prompt: "柔和马卡龙配色，亲和、轻快、干净" },
  { value: "warm", label: "暖色", prompt: "温暖明亮配色，友好、有生活感" },
  { value: "mono", label: "黑白极简", prompt: "黑白极简配色，少量强调色，克制专业" },
  { value: "bluegreen", label: "蓝绿色", prompt: "蓝绿色系，清爽、可靠、科技感适中" },
  { value: "neon", label: "霓虹", prompt: "霓虹强调色，高能量，高识别度，注意保持文字可读性" },
  { value: "custom", label: "自定义主色", prompt: "围绕自定义主色建立统一配色，层次分明" },
];

const audienceOptions = ["新手创作者", "职场人", "学生", "家长", "设计师", "知识博主", "小红书用户", "产品用户"];
const sceneOptions = ["社交媒体封面和知识分享", "小红书封面", "课程配图", "海报宣传", "朋友圈分享", "产品介绍", "知识卡片", "演示文稿"];
const keyMessageOptions = [
  "用 3 个步骤快速理解主题、风格和画幅",
  "让用户一眼看懂核心结论",
  "突出一个明确的行动建议",
  "用对比帮助用户快速做选择",
  "把复杂概念拆成清楚模块",
  "强调情绪氛围和记忆点",
];
const avoidOptions = ["过多英文、模糊小字、复杂背景", "水印、二维码、品牌标志", "人物变形、错别字、乱码", "低清晰度、杂乱元素", "过度装饰、信息拥挤"];

const aspectRatioLabels: Record<string, string> = {
  "1:1": "方图",
  "16:9": "横版",
  "9:16": "竖版",
  "4:3": "横版卡片",
  "3:4": "竖版卡片",
  auto: "自动",
};

const starterIdea = "给刚开始学习 AI 绘画的人做一张入门指南";
const customOptionValue = "__custom__";

const caseStudies: CaseStudy[] = [
  {
    id: "old-photo-shadow",
    title: "旧巷影子叙事图",
    description: "旧照片质感的情绪场景，适合做成长、回忆和人生转折主题。",
    thumbnailUrl: toAppPath("/cases/case-01-old-photo-shadow.png"),
    templateData: {
      version: 1,
      contentType: "伤感",
      visualStyle: "retro",
      layout: "balanced",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "旧照片风格的场景：一个穿背心的男孩蹲在巷口吃西瓜，他身后的墙面上，自己的影子已经长成一个穿西装的成年人。",
      audience: "中年人",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "",
      scene: "深夜emo场景",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "late-night-radio-cover",
    title: "深夜电台封面",
    description: "柔和暗恋氛围的情绪封面，适合错过、怀念和深夜独白内容。",
    thumbnailUrl: toAppPath("/cases/case-02-late-night-radio.png"),
    templateData: {
      version: 1,
      contentType: "伤感",
      visualStyle: "fresh",
      layout: "balanced",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "做一张关于暗恋和错过的深夜电台封面图",
      audience: "职场人",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "今晚\n也辛苦了",
      scene: "深夜emo场景",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "wuhan-city-walk",
    title: "武汉城市漫步路线",
    description: "手绘路线教程图，适合城市攻略、周末出行和收藏型内容。",
    thumbnailUrl: toAppPath("/cases/case-03-wuhan-city-walk.png"),
    templateData: {
      version: 1,
      contentType: "tutorial",
      visualStyle: "handdrawn",
      layout: "flow",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "做一张适合周末出行的武汉城市漫步路线图",
      audience: "小红书用户",
      keyMessage: "用 3 个步骤快速理解主题、风格和画幅",
      visibleText: "武汉漫步\n半日路线",
      scene: "社交媒体封面和知识分享",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "9:16",
      quality: "normal",
    },
  },
  {
    id: "color-guide",
    title: "配色避坑指南",
    description: "高识别度知识卡片，适合设计新手快速理解对比和选择。",
    thumbnailUrl: toAppPath("/cases/case-04-color-guide.png"),
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "bold",
      layout: "contrast",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "给设计新手做一张配色避坑指南",
      audience: "设计师",
      keyMessage: "用对比帮助用户快速做选择",
      visibleText: "配色避坑\n指南",
      scene: "课程配图",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "old-bookstore-still-life",
    title: "旧书店灰尘静物",
    description: "复古静物画面，适合时间、遗忘、阅读和治愈主题。",
    thumbnailUrl: toAppPath("/cases/case-05-old-bookstore.png"),
    templateData: {
      version: 1,
      contentType: "美观的图片",
      visualStyle: "retro",
      layout: "balanced",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "做一张关于时间和遗忘的旧书店角落的灰尘静物图",
      audience: "新手创作者",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "",
      scene: "治愈图片",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "growth-quote-poster",
    title: "成长金句海报",
    description: "留白充足的情绪海报，适合成长、自律和朋友圈分享。",
    thumbnailUrl: toAppPath("/cases/case-06-growth-poster.png"),
    templateData: {
      version: 1,
      contentType: "quote-poster",
      visualStyle: "minimal",
      layout: "sparse",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "做一张关于成长和自律的温柔金句海报",
      audience: "职场人",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "慢慢来\n比较快",
      scene: "朋友圈分享",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "3:4",
      quality: "normal",
    },
  },
  {
    id: "kids-english-cover",
    title: "少儿英语博主封面",
    description: "黑板板书风格，适合知识博主把复杂内容拆成清楚模块。",
    thumbnailUrl: toAppPath("/cases/case-07-kids-english.png"),
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "blackboard",
      layout: "balanced",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "少儿英语博主",
      audience: "新手创作者",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "少儿英语\n轻松入门",
      scene: "社交媒体封面和知识分享",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "beauty-product-cover",
    title: "美妆视频产品封面",
    description: "清新明亮的产品卖点图，适合视频封面和种草内容。",
    thumbnailUrl: toAppPath("/cases/case-08-beauty-cover.png"),
    templateData: {
      version: 1,
      contentType: "product-card",
      visualStyle: "fresh",
      layout: "sparse",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "生成一张美妆博主化妆品视频的封面",
      audience: "职场人",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "通勤妆容\n快速出门",
      scene: "小红书封面",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "1:1",
      quality: "normal",
    },
  },
  {
    id: "study-comparison",
    title: "高效学习对比图",
    description: "复古霓虹对比海报，用左右差异快速建立记忆点。",
    thumbnailUrl: toAppPath("/cases/case-09-study-comparison.png"),
    templateData: {
      version: 1,
      contentType: "quote-poster",
      visualStyle: "retro",
      layout: "contrast",
      palette: "neon",
      customColor: "#14b8a6",
      topic: "高效学习 vs 低效学习，复古霓虹对比海报",
      audience: "学生",
      keyMessage: "用对比帮助用户快速做选择",
      visibleText: "高效学习\n低效学习",
      scene: "社交媒体封面和知识分享",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "normal",
    },
  },
  {
    id: "cat-checklist",
    title: "新手养猫准备清单",
    description: "可收藏的清单式知识卡，适合宠物科普和新手指南。",
    thumbnailUrl: toAppPath("/cases/case-10-cat-checklist.png"),
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "cute",
      layout: "list",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给新手铲屎官做一张养猫准备清单",
      audience: "新手创作者",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "新手养猫\n准备清单",
      scene: "知识卡片",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "featured-visual",
    title: "精选视觉案例",
    description: "从最近生成结果沉淀出的通用案例，可作为新作品的视觉起点。",
    thumbnailUrl: toAppPath("/cases/case-11-featured-visual.png"),
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "fresh",
      layout: "balanced",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "做一张适合社交媒体发布的精选视觉案例图",
      audience: "新手创作者",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "灵感案例",
      scene: "社交媒体封面和知识分享",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "featured-cover",
    title: "精选封面案例",
    description: "适合标题突出的封面方向，能快速套用到知识分享和图文内容。",
    thumbnailUrl: toAppPath("/cases/case-12-featured-cover.png"),
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "bold",
      layout: "balanced",
      palette: "bluegreen",
      customColor: "#14b8a6",
      topic: "做一张适合小红书发布的精选封面图",
      audience: "小红书用户",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "今天就能用",
      scene: "小红书封面",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "first-image-tutorial",
    title: "第一张 AI 图教程",
    description: "手绘笔记风教程图，适合把流程拆成可执行步骤。",
    thumbnailUrl: toAppPath("/cases/case-13-ai-guide-card.png"),
    templateData: {
      version: 1,
      contentType: "tutorial",
      visualStyle: "handdrawn",
      layout: "flow",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "从 0 到 1 做出第一张 AI 图",
      audience: "新手创作者",
      keyMessage: "用 3 个步骤快速理解主题、风格和画幅",
      visibleText: "第一张 AI 图\n3 步完成",
      scene: "课程配图",
      avoid: "人物变形、错别字、乱码",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
];

const creativeInspirations: CreativeInspiration[] = [
  {
    id: "parent-english-steps",
    title: "英语启蒙 3 步走",
    description: "给家长看的少儿英语启蒙封面，重点是简单、可信、能立刻照做。",
    tip: "标题保持短，步骤控制在 3 个，画面可以加入课堂或黑板元素。",
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "blackboard",
      layout: "flow",
      palette: "auto",
      customColor: "#14b8a6",
      topic: "给宝妈做一张少儿英语启蒙封面",
      audience: "家长",
      keyMessage: "用 3 个步骤快速理解主题、风格和画幅",
      visibleText: "英语启蒙\n3 步走",
      scene: "小红书封面",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "workplace-focus-card",
    title: "下班前的专注清单",
    description: "适合职场效率博主的知识卡片，把行动建议拆成清楚模块。",
    tip: "把重点写成清单式短句，留出足够空白让内容更利落。",
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "notion",
      layout: "list",
      palette: "bluegreen",
      customColor: "#14b8a6",
      topic: "给职场人做一张下班前专注清单",
      audience: "职场人",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "下班前\n专注清单",
      scene: "社交媒体封面和知识分享",
      avoid: "过度装饰、信息拥挤",
      aspectRatio: "1:1",
      quality: "2k",
    },
  },
  {
    id: "beauty-commute-cover",
    title: "3 分钟通勤妆",
    description: "美妆视频封面方向，强调快速、干净和成片高级感。",
    tip: "画面文字不要太多，突出一个主结果和一个使用场景。",
    templateData: {
      version: 1,
      contentType: "product-card",
      visualStyle: "fresh",
      layout: "sparse",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给美妆博主做一张 3 分钟通勤妆视频封面",
      audience: "小红书用户",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "3 分钟\n通勤妆",
      scene: "小红书封面",
      avoid: "人物变形、错别字、乱码",
      aspectRatio: "1:1",
      quality: "2k",
    },
  },
  {
    id: "study-vs-scroll",
    title: "学习 vs 刷手机",
    description: "对比型信息图，用强对比帮助学生快速理解差异。",
    tip: "左右信息量保持接近，差异点不要超过 4 个。",
    templateData: {
      version: 1,
      contentType: "comparison",
      visualStyle: "bold",
      layout: "contrast",
      palette: "neon",
      customColor: "#14b8a6",
      topic: "学习 30 分钟 vs 刷手机 30 分钟的对比分析图",
      audience: "学生",
      keyMessage: "用对比帮助用户快速做选择",
      visibleText: "学习 30 分钟\n刷手机 30 分钟",
      scene: "课程配图",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "ai-prompt-starter",
    title: "Prompt 新手公式",
    description: "AI 绘画入门教程图，把提示词方法讲成容易记住的公式。",
    tip: "建议使用流程布局，让读者从主题、风格、画幅一路读下去。",
    templateData: {
      version: 1,
      contentType: "tutorial",
      visualStyle: "handdrawn",
      layout: "flow",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给 AI 绘画新手做一张 Prompt 入门公式教程图",
      audience: "新手创作者",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "Prompt 公式\n新手也能用",
      scene: "知识卡片",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "growth-soft-poster",
    title: "慢慢来比较快",
    description: "温柔成长主题金句海报，适合朋友圈和情绪价值内容。",
    tip: "让背景服务情绪，标题两行以内，保留呼吸感。",
    templateData: {
      version: 1,
      contentType: "quote-poster",
      visualStyle: "minimal",
      layout: "sparse",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "做一张关于成长和自律的温柔金句海报",
      audience: "职场人",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "慢慢来\n比较快",
      scene: "朋友圈分享",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "product-launch-card",
    title: "新品卖点一眼懂",
    description: "适合产品发布和卖点说明，把价值、场景和行动建议放在同一张图里。",
    tip: "主卖点只保留一个，辅助说明不超过三条。",
    templateData: {
      version: 1,
      contentType: "product-card",
      visualStyle: "minimal",
      layout: "balanced",
      palette: "bluegreen",
      customColor: "#14b8a6",
      topic: "给一款新上线的效率工具做产品卖点图",
      audience: "产品用户",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "新品上线\n效率翻倍",
      scene: "产品介绍",
      avoid: "过度装饰、信息拥挤",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "parent-reading-plan",
    title: "亲子阅读计划",
    description: "给家长看的温和知识卡，把阅读方法做成容易坚持的计划表。",
    tip: "可以加入日历、书本、便签元素，但不要让背景抢文字。",
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "cute",
      layout: "list",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给家长做一张 7 天亲子阅读计划知识卡",
      audience: "家长",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "7 天亲子阅读\n轻松开始",
      scene: "知识卡片",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "designer-color-guide",
    title: "配色避坑指南",
    description: "适合设计师和内容创作者的教程图，用对比解释好看与杂乱的区别。",
    tip: "用一组正反例最有效，标题要直接给出结论。",
    templateData: {
      version: 1,
      contentType: "comparison",
      visualStyle: "bold",
      layout: "contrast",
      palette: "mono",
      customColor: "#14b8a6",
      topic: "给设计新手做一张配色避坑指南",
      audience: "设计师",
      keyMessage: "用对比帮助用户快速做选择",
      visibleText: "配色避坑\n这样更高级",
      scene: "课程配图",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "4:3",
      quality: "2k",
    },
  },
  {
    id: "xiaohongshu-hook-cover",
    title: "小红书开头钩子",
    description: "给内容博主的封面方向，重点是让用户第一眼知道为什么要点开。",
    tip: "标题要像一句强结论，画面只服务一个钩子。",
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "bold",
      layout: "balanced",
      palette: "neon",
      customColor: "#14b8a6",
      topic: "给小红书博主做一张爆款开头钩子封面",
      audience: "知识博主",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "别再这样开头\n3 秒抓住人",
      scene: "小红书封面",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "student-review-map",
    title: "期末复习地图",
    description: "把复习任务做成路线图，适合学生快速规划接下来的学习节奏。",
    tip: "流程不要超过五步，让每一步都有清楚动作。",
    templateData: {
      version: 1,
      contentType: "tutorial",
      visualStyle: "handdrawn",
      layout: "flow",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给学生做一张期末复习路线图",
      audience: "学生",
      keyMessage: "用 3 个步骤快速理解主题、风格和画幅",
      visibleText: "期末复习\n路线图",
      scene: "课程配图",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "healing-night-poster",
    title: "睡前治愈海报",
    description: "适合情绪价值内容，用低噪点画面和短句营造安静氛围。",
    tip: "画面文字越短越好，留白就是情绪的一部分。",
    templateData: {
      version: 1,
      contentType: "quote-poster",
      visualStyle: "fresh",
      layout: "sparse",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "做一张睡前治愈主题的温柔金句海报",
      audience: "小红书用户",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "今晚\n也辛苦了",
      scene: "朋友圈分享",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "9:16",
      quality: "2k",
    },
  },
  {
    id: "coffee-shop-guide",
    title: "周末咖啡探店",
    description: "适合生活方式博主的探店封面，突出氛围、路线和推荐理由。",
    tip: "让画面先给出气味和光线，文字只保留店名、路线和一个亮点。",
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "fresh",
      layout: "balanced",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "给生活方式博主做一张周末咖啡探店封面",
      audience: "小红书用户",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "周末咖啡\n探店地图",
      scene: "小红书封面",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "city-walk-route",
    title: "城市漫步路线",
    description: "旅行和本地生活内容的路线图，把地点、节奏和看点串起来。",
    tip: "路线图要有清楚起点和终点，地点不要超过五个。",
    templateData: {
      version: 1,
      contentType: "tutorial",
      visualStyle: "handdrawn",
      layout: "flow",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "做一张适合周末出行的城市漫步路线图",
      audience: "小红书用户",
      keyMessage: "用 3 个步骤快速理解主题、风格和画幅",
      visibleText: "城市漫步\n半日路线",
      scene: "社交媒体封面和知识分享",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "9:16",
      quality: "2k",
    },
  },
  {
    id: "fitness-beginner-plan",
    title: "新手健身计划",
    description: "健身入门知识卡，适合把动作、频率和注意事项讲清楚。",
    tip: "动作数量少一点，重点给出可执行的第一周安排。",
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "bold",
      layout: "list",
      palette: "bluegreen",
      customColor: "#14b8a6",
      topic: "给健身新手做一张第一周训练计划知识卡",
      audience: "新手创作者",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "健身新手\n第一周计划",
      scene: "知识卡片",
      avoid: "人物变形、错别字、乱码",
      aspectRatio: "1:1",
      quality: "2k",
    },
  },
  {
    id: "recruitment-poster",
    title: "团队招新海报",
    description: "适合社群、校园和项目组招新的海报方向，强调加入理由。",
    tip: "把岗位、亮点和行动入口放在三个清晰层级里。",
    templateData: {
      version: 1,
      contentType: "quote-poster",
      visualStyle: "bold",
      layout: "balanced",
      palette: "neon",
      customColor: "#14b8a6",
      topic: "给一个创作者社群做一张团队招新海报",
      audience: "学生",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "一起做点\n有意思的事",
      scene: "海报宣传",
      avoid: "水印、二维码、品牌标志",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "online-course-value",
    title: "课程价值清单",
    description: "课程宣传卖点图，适合把学习收益、适合人群和交付内容说清楚。",
    tip: "不要罗列太多课时，优先突出学完能解决什么问题。",
    templateData: {
      version: 1,
      contentType: "product-card",
      visualStyle: "minimal",
      layout: "balanced",
      palette: "bluegreen",
      customColor: "#14b8a6",
      topic: "给一门线上课程做一张课程价值清单",
      audience: "职场人",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "学完这门课\n你会得到什么",
      scene: "产品介绍",
      avoid: "过度装饰、信息拥挤",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "livestream-preview",
    title: "直播预告封面",
    description: "适合直播间、公开课和活动预告，重点是时间、主题和期待感。",
    tip: "时间信息要醒目，背景可以更有舞台感但不要盖住标题。",
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "bold",
      layout: "balanced",
      palette: "neon",
      customColor: "#14b8a6",
      topic: "给一场 AI 绘画公开课做直播预告封面",
      audience: "新手创作者",
      keyMessage: "突出一个明确的行动建议",
      visibleText: "今晚 8 点\nAI 绘画公开课",
      scene: "海报宣传",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "16:9",
      quality: "2k",
    },
  },
  {
    id: "year-review-card",
    title: "年度复盘卡片",
    description: "适合个人成长和职场复盘，把成果、遗憾和下一步整理成一页。",
    tip: "用模块化结构承载信息，标题先给出这一年的关键词。",
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "notion",
      layout: "dense",
      palette: "mono",
      customColor: "#14b8a6",
      topic: "做一张个人年度复盘总结卡片",
      audience: "职场人",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "年度复盘\n我的关键词",
      scene: "朋友圈分享",
      avoid: "过度装饰、信息拥挤",
      aspectRatio: "1:1",
      quality: "2k",
    },
  },
  {
    id: "podcast-cover",
    title: "播客单集封面",
    description: "适合播客和长内容摘要，把本期主题做成清晰的视觉入口。",
    tip: "封面要突出一个观点，不要把整期大纲都塞进去。",
    templateData: {
      version: 1,
      contentType: "xiaohongshu-cover",
      visualStyle: "retro",
      layout: "sparse",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "给一集关于职场成长的播客做封面",
      audience: "职场人",
      keyMessage: "强调情绪氛围和记忆点",
      visibleText: "职场成长\n别急着证明自己",
      scene: "社交媒体封面和知识分享",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "1:1",
      quality: "2k",
    },
  },
  {
    id: "pet-care-guide",
    title: "新手养猫指南",
    description: "宠物知识卡方向，适合把准备清单和避坑事项做得轻松可爱。",
    tip: "可以用可爱风，但信息层级要清楚，避免过度装饰。",
    templateData: {
      version: 1,
      contentType: "knowledge-card",
      visualStyle: "cute",
      layout: "list",
      palette: "pastel",
      customColor: "#14b8a6",
      topic: "给新手铲屎官做一张养猫准备清单",
      audience: "新手创作者",
      keyMessage: "把复杂概念拆成清楚模块",
      visibleText: "新手养猫\n准备清单",
      scene: "知识卡片",
      avoid: "低清晰度、杂乱元素",
      aspectRatio: "3:4",
      quality: "2k",
    },
  },
  {
    id: "restaurant-menu-card",
    title: "招牌菜单推荐",
    description: "适合餐饮店、小吃摊和探店内容，把招牌菜做成一眼想点的卡片。",
    tip: "菜品不要超过三款，价格和卖点保持清楚可读。",
    templateData: {
      version: 1,
      contentType: "product-card",
      visualStyle: "fresh",
      layout: "balanced",
      palette: "warm",
      customColor: "#14b8a6",
      topic: "给一家小餐馆做一张招牌菜单推荐图",
      audience: "产品用户",
      keyMessage: "让用户一眼看懂核心结论",
      visibleText: "今日招牌\n必点三样",
      scene: "产品介绍",
      avoid: "过多英文、模糊小字、复杂背景",
      aspectRatio: "4:3",
      quality: "2k",
    },
  },
];

function getSmartRecommendation(params: {
  contentType: string;
  topic: string;
  keyMessage: string;
  visibleText: string;
}): SmartRecommendation {
  const text = `${params.topic} ${params.keyMessage} ${params.visibleText}`;
  const hasSteps = /步骤|流程|方法|指南|教程|step|how/i.test(text);
  const hasProduct = /产品|卖点|价格|功能|转化|购买|品牌/.test(text);
  const hasQuote = /金句|语录|句子|情绪|治愈|成长/.test(text);

  if (params.contentType === "tutorial" || hasSteps) {
    return {
      style: "handdrawn",
      layout: "flow",
      palette: "pastel",
      aspectRatio: "3:4",
      quality: "2k",
      reason: "这类内容需要清楚的阅读路径，流程布局和手绘标注更容易让人照着做。",
      tips: ["把步骤控制在 3 到 5 个", "画面文字尽量短", "每一步只表达一个动作"],
    };
  }

  if (params.contentType === "product-card" || hasProduct) {
    return {
      style: "minimal",
      layout: "balanced",
      palette: "bluegreen",
      aspectRatio: "1:1",
      quality: "2k",
      reason: "产品卖点图更适合稳定、清晰、可信的表达，减少装饰能让核心价值更突出。",
      tips: ["保留一个主卖点", "使用场景要具体", "避免同时塞进太多功能"],
    };
  }

  if (params.contentType === "quote-poster" || hasQuote) {
    return {
      style: "fresh",
      layout: "sparse",
      palette: "warm",
      aspectRatio: "3:4",
      quality: "2k",
      reason: "金句海报需要情绪和留白，稀疏布局能给文字更多呼吸感。",
      tips: ["画面文字不要超过两行", "让背景服务于情绪", "保留足够留白"],
    };
  }

  if (params.contentType === "comparison") {
    return {
      style: "bold",
      layout: "contrast",
      palette: "mono",
      aspectRatio: "16:9",
      quality: "2k",
      reason: "对比内容需要快速看出差异，高对比和分区布局能降低理解成本。",
      tips: ["左右两侧信息量保持接近", "对比维度不超过 4 个", "用颜色强调关键差异"],
    };
  }

  if (params.contentType === "knowledge-card") {
    return {
      style: "notion",
      layout: "list",
      palette: "bluegreen",
      aspectRatio: "1:1",
      quality: "2k",
      reason: "知识卡片重在结构化和收藏价值，列表布局更利于快速扫读。",
      tips: ["标题先给结论", "正文用短句", "把概念拆成清楚模块"],
    };
  }

  return {
    style: "fresh",
    layout: "balanced",
    palette: "pastel",
    aspectRatio: "3:4",
    quality: "2k",
    reason: "封面内容需要第一眼好看、信息集中，清新风格和竖版卡片更适合社交媒体。",
    tips: ["标题保持醒目", "主体不要太靠边", "用一处小装饰制造记忆点"],
  };
}

function findPrompt(options: Option[], value: string): string {
  return options.find((item) => item.value === value)?.prompt || "";
}

function findLabel(options: Option[], value: string): string {
  return options.find((item) => item.value === value)?.label || value;
}

function isProjectData(value: unknown): value is ProjectData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.version === 1 &&
    typeof data.contentType === "string" &&
    typeof data.visualStyle === "string" &&
    typeof data.layout === "string" &&
    typeof data.palette === "string" &&
    typeof data.topic === "string"
  );
}

function buildGuidedPrompt(params: {
  contentType: string;
  style: string;
  layout: string;
  palette: string;
  customColor: string;
  topic: string;
  audience: string;
  keyMessage: string;
  visibleText: string;
  scene: string;
  avoid: string;
  aspectRatio: string;
}): string {
  const parts = [
    `请生成一张中文视觉设计图。类型：${findLabel(contentTypes, params.contentType)}。`,
    `主题：${params.topic.trim() || starterIdea}。`,
    params.audience.trim() ? `目标受众：${params.audience.trim()}。` : "",
    params.keyMessage.trim() ? `核心信息：${params.keyMessage.trim()}。` : "",
    params.visibleText.trim() ? `画面中需要出现的中文文字：${params.visibleText.trim()}。请保证文字清晰、不要乱码、不要错别字。` : "",
    params.scene.trim() ? `使用场景：${params.scene.trim()}。` : "",
    `内容形式要求：${findPrompt(contentTypes, params.contentType)}。`,
    `视觉风格：${findPrompt(styleOptions, params.style)}。`,
    `布局要求：${findPrompt(layoutOptions, params.layout)}。`,
    `配色要求：${findPrompt(paletteOptions, params.palette)}${params.palette === "custom" && params.customColor.trim() ? `，主色参考 ${params.customColor.trim()}` : ""}。`,
    `画幅：${params.aspectRatio}，${aspectRatioLabels[params.aspectRatio] || "适合内容的画幅"}。`,
    "请把用户填写的内容转化为高质量视觉设计，不要把提示词说明、参数名或内部生成逻辑写到画面里。",
    "画面需要有完整的设计感、清晰的信息层级、整洁边距和可读排版。",
    "不要出现水印、品牌标志、二维码、真实个人信息、杂乱背景或变形文字。",
    params.avoid.trim() ? `额外避免：${params.avoid.trim()}。` : "",
  ];

  return parts.filter(Boolean).join("\n");
}

function upsertJob(list: GenerationJob[], nextJob: GenerationJob): GenerationJob[] {
  const rest = list.filter((item) => item.id !== nextJob.id);
  return [nextJob, ...rest].filter((item) => item.provider === "kie").slice(0, 20);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(value?: string): string {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildDownloadName(job: GenerationJob): string {
  const date = new Date(job.createdAt || Date.now());
  const stamp = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/[^\d]/g, "")
    .slice(0, 12);
  return `banana2-${stamp}-${shortId(job.id)}.png`;
}

function getShortError(message: string): string {
  return message.length > 72 ? `${message.slice(0, 72)}...` : message;
}

function getJobTitle(job: GenerationJob): string {
  if (isProjectData(job.projectData) && job.projectData.topic.trim()) {
    return job.projectData.topic.trim();
  }
  return `作品 ${shortId(job.id)}`;
}

function getJobMeta(job: GenerationJob): string {
  if (!isProjectData(job.projectData)) {
    return `香蕉 2 · ${statusLabels[job.status]} · ${job.aspectRatio || "1:1"} · ${formatTime(job.createdAt)}`;
  }

  const data = job.projectData;
  return [
    findLabel(contentTypes, data.contentType),
    findLabel(styleOptions, data.visualStyle),
    findLabel(layoutOptions, data.layout),
    findLabel(paletteOptions, data.palette),
    statusLabels[job.status],
    formatTime(job.createdAt),
  ].join(" · ");
}

function App() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [contentType, setContentType] = useState("xiaohongshu-cover");
  const [visualStyle, setVisualStyle] = useState("fresh");
  const [layout, setLayout] = useState("balanced");
  const [palette, setPalette] = useState("auto");
  const [customColor, setCustomColor] = useState("#14b8a6");
  const [topic, setTopic] = useState(starterIdea);
  const [audience, setAudience] = useState("新手创作者");
  const [keyMessage, setKeyMessage] = useState("用 3 个步骤快速理解主题、风格和画幅");
  const [visibleText, setVisibleText] = useState("AI 绘画入门\n3 步做出第一张图");
  const [scene, setScene] = useState("社交媒体封面和知识分享");
  const [avoid, setAvoid] = useState("过多英文、模糊小字、复杂背景");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [quality, setQuality] = useState("2k");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [history, setHistory] = useState<GenerationJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [previewJob, setPreviewJob] = useState<GenerationJob | null>(null);
  const [previewCase, setPreviewCase] = useState<CaseStudy | null>(null);
  const [currentInspiration, setCurrentInspiration] = useState<CreativeInspiration | null>(null);
  const pollTimer = useRef<number | null>(null);
  const settledRunsRef = useRef<Set<string>>(new Set());
  const settlingRunsRef = useRef<Set<string>>(new Set());

  const generatedPrompt = useMemo(
    () =>
      buildGuidedPrompt({
        contentType,
        style: visualStyle,
        layout,
        palette,
        customColor,
        topic,
        audience,
        keyMessage,
        visibleText,
        scene,
        avoid,
        aspectRatio,
      }),
    [contentType, visualStyle, layout, palette, customColor, topic, audience, keyMessage, visibleText, scene, avoid, aspectRatio],
  );

  const smartRecommendation = useMemo(
    () =>
      getSmartRecommendation({
        contentType,
        topic,
        keyMessage,
        visibleText,
      }),
    [contentType, topic, keyMessage, visibleText],
  );

  const projectData = useMemo<ProjectData>(
    () => ({
      version: 1,
      contentType,
      visualStyle,
      layout,
      palette,
      customColor,
      topic,
      audience,
      keyMessage,
      visibleText,
      scene,
      avoid,
      aspectRatio,
      quality,
    }),
    [contentType, visualStyle, layout, palette, customColor, topic, audience, keyMessage, visibleText, scene, avoid, aspectRatio, quality],
  );

  const isBusy = job?.status === "queued" || job?.status === "running" || isSubmitting;
  const imageUrl = toAbsoluteResultUrl(job?.outputUrl ?? null);
  const isGenerating = isSubmitting || job?.status === "queued" || job?.status === "running";
  const showCaseGallery = !job && !imageUrl;
  const statusText = useMemo(() => {
    if (isSubmitting) return "提交中";
    if (!job) return "准备就绪";
    return statusLabels[job.status];
  }, [isSubmitting, job]);

  useEffect(() => {
    fetchConfig();
    fetchHistory();
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  async function registerWf002Run(promptText: string, ratio: string): Promise<WorkflowBillingMeta> {
    const token = readAuthToken();
    if (!token) {
      throw new Error("未找到登录 token，请重新登录后重试。");
    }

    const authApiBase = resolveAuthApiBase();
    if (!authApiBase) {
      throw new Error("未找到中台 API 地址，无法登记积分冻结。");
    }

    const clientRequestId = buildClientRequestId();
    const response = await fetch(`${authApiBase}/api/v1/workflow-runs/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_code: "WF-002",
        client_request_id: clientRequestId,
        request_payload_summary: {
          source: "WF_002/BaoyuSkill",
          prompt_preview: promptText.slice(0, 120),
          aspect_ratio: ratio,
          executor_type: "baoyu_skill_local_generator",
          billing_mode: "fixed_points",
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `积分登记失败: ${response.status}`);
    }

    const data = (await response.json()) as WorkflowRegisterResponse;
    if (!data.run_id) {
      throw new Error("积分登记失败：未返回 run_id");
    }

    return {
      workflowCode: "WF-002",
      runId: data.run_id,
      clientRequestId,
      estimatedFrozenPoints: Number(data.estimated_frozen_points ?? 0),
    };
  }

  async function settleWf002Run(
    billingMeta: WorkflowBillingMeta,
    payload: {
      status: "success" | "failed";
      actualCompletedCount: number;
      resultSummary: string;
      resultSummaryUrl: string | null;
      resultUrls: string[];
      externalTaskId: string;
      errorMessage?: string | null;
    },
  ) {
    if (settledRunsRef.current.has(billingMeta.runId)) {
      return;
    }
    if (settlingRunsRef.current.has(billingMeta.runId)) {
      return;
    }

    const token = readAuthToken();
    if (!token) {
      throw new Error("未找到登录 token，无法完成积分结算。");
    }

    const authApiBase = resolveAuthApiBase();
    if (!authApiBase) {
      throw new Error("未找到中台 API 地址，无法完成积分结算。");
    }

    settlingRunsRef.current.add(billingMeta.runId);
    try {
      const response = await fetch(`${authApiBase}/api/v1/workflow-runs/callback-auth`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id: billingMeta.runId,
          workflow_code: billingMeta.workflowCode,
          status: payload.status,
          actual_completed_count: payload.actualCompletedCount,
          result_summary: payload.resultSummary,
          result_summary_url: payload.resultSummaryUrl,
          result_urls: payload.resultUrls,
          external_task_id: payload.externalTaskId,
          error_message: payload.errorMessage ?? null,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `积分结算失败: ${response.status}`);
      }

      settledRunsRef.current.add(billingMeta.runId);
    } finally {
      settlingRunsRef.current.delete(billingMeta.runId);
    }
  }

  async function settleWf002RunByJob(nextJob: GenerationJob) {
    if (nextJob.status !== "succeeded" && nextJob.status !== "failed") {
      return;
    }

    const billingMeta = getBillingMeta(nextJob.projectData);
    if (!billingMeta) {
      return;
    }

    const isSuccess = nextJob.status === "succeeded";
    const absoluteUrl = toAbsoluteResultUrl(nextJob.outputUrl);
    await settleWf002Run(billingMeta, {
      status: isSuccess ? "success" : "failed",
      actualCompletedCount: isSuccess ? 1 : 0,
      resultSummary: isSuccess
        ? "WF-002 BaoyuSkill image generation succeeded"
        : "WF-002 BaoyuSkill image generation failed",
      resultSummaryUrl: isSuccess ? absoluteUrl : null,
      resultUrls: isSuccess && absoluteUrl ? [absoluteUrl] : [],
      externalTaskId: nextJob.id,
      errorMessage: isSuccess ? null : nextJob.error || "WF-002 generation failed",
    });
  }

  async function fetchConfig() {
    try {
      const res = await fetch(toAppPath("/api/config"));
      if (!res.ok) throw new Error(`读取配置失败：${res.status}`);
      const nextConfig = (await res.json()) as ConfigResponse;
      setConfig(nextConfig);
      setAspectRatio(nextConfig.aspectRatios.includes("1:1") ? "1:1" : nextConfig.aspectRatios[0] || "1:1");
      setQuality(nextConfig.qualities.includes("2k") ? "2k" : nextConfig.qualities[0] || "normal");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function fetchHistory() {
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(toAppPath("/api/generations?limit=20"));
      if (!res.ok) throw new Error(`读取历史失败：${res.status}`);
      const data = (await res.json()) as HistoryResponse;
      const bananaJobs = data.jobs.filter((item) => item.provider === "kie");
      setHistory(bananaJobs);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function pollJob(jobId: string) {
      const res = await fetch(toAppPath(`/api/generations/${jobId}`));
    if (!res.ok) throw new Error(`读取任务失败：${res.status}`);
    const nextJob = (await res.json()) as GenerationJob;
    setJob(nextJob);
    setHistory((current) => upsertJob(current, nextJob));

    if (nextJob.status === "queued" || nextJob.status === "running") {
      pollTimer.current = window.setTimeout(() => {
        void pollJob(jobId).catch((caught) => {
          setError(caught instanceof Error ? caught.message : String(caught));
        });
      }, 1800);
      return;
    }

    try {
      await settleWf002RunByJob(nextJob);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(`图片已生成，但积分结算失败：${message}`);
    }
  }

  async function submitGeneration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPrompt = generatedPrompt.trim();
    if (!cleanPrompt) {
      setError("请先填写主题");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setJob(null);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);

    let billingMeta: WorkflowBillingMeta | null = null;
    let createdJobId: string | null = null;

    try {
      billingMeta = await registerWf002Run(cleanPrompt, aspectRatio);

      const form = new FormData();
      form.set("prompt", cleanPrompt);
      form.set("provider", "kie");
      form.set("model", "nano-banana-2");
      form.set("aspectRatio", aspectRatio);
      form.set("quality", quality);
      form.set("projectData", JSON.stringify({ ...projectData, __wf002Billing: billingMeta }));

      const res = await fetch(toAppPath("/api/generations"), {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `创建生成任务失败：${res.status}`);
      }

      const created = (await res.json()) as CreateGenerationResponse;
      createdJobId = created.jobId;
      setJob(created.job);
      setHistory((current) => upsertJob(current, created.job));
      await pollJob(created.jobId);
    } catch (caught) {
      const baseMessage = caught instanceof Error ? caught.message : String(caught);

      if (billingMeta && !createdJobId) {
        try {
          await settleWf002Run(billingMeta, {
            status: "failed",
            actualCompletedCount: 0,
            resultSummary: "WF-002 BaoyuSkill job creation failed",
            resultSummaryUrl: null,
            resultUrls: [],
            externalTaskId: billingMeta.clientRequestId,
            errorMessage: baseMessage,
          });
        } catch (settleCaught) {
          const settleMessage = settleCaught instanceof Error ? settleCaught.message : String(settleCaught);
          setError(`${baseMessage}；并且积分回滚失败：${settleMessage}`);
          return;
        }
      }

      setError(baseMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectHistoryItem(nextJob: GenerationJob) {
    setError(null);
    setJob(nextJob);
    if (isProjectData(nextJob.projectData)) {
      setContentType(nextJob.projectData.contentType);
      setVisualStyle(nextJob.projectData.visualStyle);
      setLayout(nextJob.projectData.layout);
      setPalette(nextJob.projectData.palette);
      setCustomColor(nextJob.projectData.customColor);
      setTopic(nextJob.projectData.topic);
      setAudience(nextJob.projectData.audience);
      setKeyMessage(nextJob.projectData.keyMessage);
      setVisibleText(nextJob.projectData.visibleText);
      setScene(nextJob.projectData.scene);
      setAvoid(nextJob.projectData.avoid);
      setAspectRatio(nextJob.projectData.aspectRatio);
      setQuality(nextJob.projectData.quality);
    } else {
      setAspectRatio(nextJob.aspectRatio || "1:1");
      setQuality(nextJob.quality === "normal" ? "normal" : "2k");
    }
    if (nextJob.status === "queued" || nextJob.status === "running") {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      void pollJob(nextJob.id).catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
      return;
    }

    void settleWf002RunByJob(nextJob).catch((caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(`历史任务结算失败：${message}`);
    });
  }

  function applySmartRecommendation() {
    setVisualStyle(smartRecommendation.style);
    setLayout(smartRecommendation.layout);
    setPalette(smartRecommendation.palette);
    setAspectRatio(smartRecommendation.aspectRatio);
    setQuality(smartRecommendation.quality);
    setError(null);
  }

  function applyCaseTemplate(caseStudy: CaseStudy) {
    const data = caseStudy.templateData;
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setContentType(data.contentType);
    setVisualStyle(data.visualStyle);
    setLayout(data.layout);
    setPalette(data.palette);
    setCustomColor(data.customColor);
    setTopic(data.topic);
    setAudience(data.audience);
    setKeyMessage(data.keyMessage);
    setVisibleText(data.visibleText);
    setScene(data.scene);
    setAvoid(data.avoid);
    setAspectRatio(data.aspectRatio);
    setQuality(data.quality);
    setJob(null);
    setPreviewCase(null);
    setCurrentInspiration(null);
    setError(null);
    setHistoryError(null);
  }

  function applyCreativeInspiration() {
    const pool = currentInspiration && creativeInspirations.length > 1
      ? creativeInspirations.filter((item) => item.id !== currentInspiration.id)
      : creativeInspirations;
    const next = pool[Math.floor(Math.random() * pool.length)];
    const data = next.templateData;
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setCurrentInspiration(next);
    setContentType(data.contentType);
    setVisualStyle(data.visualStyle);
    setLayout(data.layout);
    setPalette(data.palette);
    setCustomColor(data.customColor);
    setTopic(data.topic);
    setAudience(data.audience);
    setKeyMessage(data.keyMessage);
    setVisibleText(data.visibleText);
    setScene(data.scene);
    setAvoid(data.avoid);
    setAspectRatio(data.aspectRatio);
    setQuality(data.quality);
    setJob(null);
    setPreviewCase(null);
    setError(null);
    setHistoryError(null);
  }

  function startNewProject() {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setContentType("xiaohongshu-cover");
    setVisualStyle("fresh");
    setLayout("balanced");
    setPalette("auto");
    setCustomColor("#14b8a6");
    setTopic("");
    setAudience("新手创作者");
    setKeyMessage("用 3 个步骤快速理解主题、风格和画幅");
    setVisibleText("");
    setScene("社交媒体封面和知识分享");
    setAvoid("过多英文、模糊小字、复杂背景");
    setAspectRatio(config?.aspectRatios.includes("3:4") ? "3:4" : config?.aspectRatios[0] || "1:1");
    setQuality(config?.qualities.includes("2k") ? "2k" : config?.qualities[0] || "normal");
    setJob(null);
    setPreviewJob(null);
    setPreviewCase(null);
    setCurrentInspiration(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteHistoryItem(target: GenerationJob, event?: React.MouseEvent<HTMLButtonElement>) {
    event?.stopPropagation();
    if (target.status === "queued" || target.status === "running") {
      setError("生成中的任务暂时不能删除。");
      return;
    }

    setDeletingJobId(target.id);
    setError(null);
    try {
      const res = await fetch(toAppPath(`/api/generations/${target.id}`), {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `删除失败：${res.status}`);
      }

      setHistory((current) => current.filter((item) => item.id !== target.id));
      if (job?.id === target.id) {
        setJob(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeletingJobId(null);
    }
  }

  const aspectRatioChoices = [...(config?.aspectRatios || ["1:1", "16:9", "9:16", "4:3", "3:4"]), "auto"];
  const qualityChoices = config?.qualities || ["normal", "2k"];
  const isCustomContentType = !contentTypes.some((item) => item.value === contentType);
  const isCustomStyle = !styleOptions.some((item) => item.value === visualStyle);
  const isCustomLayout = !layoutOptions.some((item) => item.value === layout);
  const isCustomPalette = !paletteOptions.some((item) => item.value === palette);
  const isCustomAspectRatio = !aspectRatioChoices.includes(aspectRatio);
  const isCustomQuality = !qualityChoices.includes(quality as "normal" | "2k");
  const isCustomAudience = !audienceOptions.includes(audience);
  const isCustomScene = !sceneOptions.includes(scene);
  const isCustomKeyMessage = !keyMessageOptions.includes(keyMessage);
  const isCustomAvoid = !avoidOptions.includes(avoid);

  return (
    <main className="app-shell">
      <div className="ambient-layer ambient-layer-left" aria-hidden="true" />
      <div className="ambient-layer ambient-layer-right" aria-hidden="true" />
      <aside className="sidebar" aria-label="工作台导航">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <img className="brand-logo" src={`${toAppPath("/logo.png")}?v=${BRAND_ASSET_VERSION}`} alt="" />
          </div>
          <div>
            <strong>GETRUE 图片大师</strong>
            <span>神经视觉工作台</span>
          </div>
        </div>

        <button className="nav-action" type="button" onClick={startNewProject}>
          新建作品
        </button>

        <div className="history-panel" aria-label="生成历史">
          <div className="history-header">
            <div>
              <p className="eyebrow">历史记录</p>
              <h2>最近生成</h2>
            </div>
          </div>

          {historyError && <p className="error-message">{historyError}</p>}

          {history.length === 0 ? (
            <div className="history-empty">
              {isHistoryLoading ? "正在读取历史..." : "还没有作品"}
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <button
                  className={`history-item ${job?.id === item.id ? "is-active" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => selectHistoryItem(item)}
                >
                  <div className="history-thumb">
                    {item.outputUrl ? <img src={toAbsoluteResultUrl(item.outputUrl) || item.outputUrl} alt="历史缩略图" /> : <span>{statusLabels[item.status]}</span>}
                  </div>
                  <div className="history-copy">
                    <strong>{getJobTitle(item)}</strong>
                    <span>{getJobMeta(item)}</span>
                    {item.error && <small>{getShortError(item.error)}</small>}
                  </div>
                  <div className="history-actions">
                    {item.outputUrl && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewJob(item);
                        }}
                      >
                        预览
                      </button>
                    )}
                    <button
                      disabled={deletingJobId === item.id || item.status === "queued" || item.status === "running"}
                      type="button"
                      onClick={(event) => void deleteHistoryItem(item, event)}
                    >
                      {deletingJobId === item.id ? "删除中" : "删除"}
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="main-stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">模型</p>
            <h1>GETRUE 图片大师</h1>
          </div>
          <nav className="top-tabs" aria-label="工作区">
            <span className="is-active">创作</span>
            <span>作品库</span>
            <span>参数</span>
          </nav>
          <div className={`status-pill status-${job?.status || "ready"}`}>{statusText}</div>
        </header>

        <div className="canvas-ambient" aria-hidden="true">
          <span className="canvas-ambient__orbit canvas-ambient__orbit--one" />
          <span className="canvas-ambient__orbit canvas-ambient__orbit--two" />
          <span className="canvas-ambient__beam canvas-ambient__beam--left" />
          <span className="canvas-ambient__beam canvas-ambient__beam--right" />
        </div>

        <section className="workspace" aria-label="图片生成工作台">
          <form className="control-surface" onSubmit={submitGeneration}>
            <section className="composer-panel" aria-label="主创作输入">
              <div className="section-heading">
                <p className="eyebrow">开始创作</p>
                <h2>你想生成什么</h2>
              </div>
              <label className="field">
                <span>主输入</span>
                <textarea
                  className="main-composer"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  rows={6}
                  placeholder="例如：做一张给 AI 绘画新手看的入门指南，画面要清爽、有步骤感，适合发小红书。"
                />
              </label>
            </section>

            <section className="guide-block compact-guide" aria-label="创作参数">
              <div className="section-heading">
                <p className="eyebrow">参数</p>
                <h2>作品设置</h2>
              </div>

              <div className="select-row">
                <label className="field">
                  <span>作品类型</span>
                  <select
                    value={isCustomContentType ? customOptionValue : contentType}
                    onChange={(event) => setContentType(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {contentTypes.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomContentType && (
                    <input className="custom-field-input" value={contentType} onChange={(event) => setContentType(event.target.value)} placeholder="输入自定义作品类型" />
                  )}
                </label>

                <label className="field">
                  <span>风格</span>
                  <select
                    value={isCustomStyle ? customOptionValue : visualStyle}
                    onChange={(event) => setVisualStyle(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {styleOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomStyle && (
                    <input className="custom-field-input" value={visualStyle} onChange={(event) => setVisualStyle(event.target.value)} placeholder="输入自定义风格" />
                  )}
                </label>
              </div>

              <div className="select-row">
                <label className="field">
                  <span>布局</span>
                  <select
                    value={isCustomLayout ? customOptionValue : layout}
                    onChange={(event) => setLayout(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {layoutOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomLayout && (
                    <input className="custom-field-input" value={layout} onChange={(event) => setLayout(event.target.value)} placeholder="输入自定义布局" />
                  )}
                </label>

                <label className="field">
                  <span>配色</span>
                  <select
                    value={isCustomPalette ? customOptionValue : palette}
                    onChange={(event) => setPalette(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {paletteOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomPalette && (
                    <input className="custom-field-input" value={palette} onChange={(event) => setPalette(event.target.value)} placeholder="输入自定义配色" />
                  )}
                </label>
              </div>

              <div className="select-row">
                <label className="field">
                  <span>画面比例</span>
                  <select
                    value={isCustomAspectRatio ? customOptionValue : aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {aspectRatioChoices.map((item) => (
                      <option key={item} value={item}>{aspectRatioLabels[item] ? `${item} · ${aspectRatioLabels[item]}` : item}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomAspectRatio && (
                    <input className="custom-field-input" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} placeholder="输入自定义比例" />
                  )}
                </label>

                <label className="field">
                  <span>清晰度</span>
                  <select
                    value={isCustomQuality ? customOptionValue : quality}
                    onChange={(event) => setQuality(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {qualityChoices.map((item) => (
                      <option key={item} value={item}>{item === "2k" ? "2K 高清" : "标准"}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomQuality && (
                    <input className="custom-field-input" value={quality} onChange={(event) => setQuality(event.target.value)} placeholder="输入自定义清晰度" />
                  )}
                </label>
              </div>

              {palette === "custom" && (
                <label className="field">
                  <span>主色</span>
                  <input value={customColor} onChange={(event) => setCustomColor(event.target.value)} placeholder="#14b8a6 或 青绿色" />
                </label>
              )}

              <div className="select-row">
                <label className="field">
                  <span>目标受众</span>
                  <select
                    value={isCustomAudience ? customOptionValue : audience}
                    onChange={(event) => setAudience(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {audienceOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomAudience && (
                    <input className="custom-field-input" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="输入自定义受众" />
                  )}
                </label>

                <label className="field">
                  <span>使用场景</span>
                  <select
                    value={isCustomScene ? customOptionValue : scene}
                    onChange={(event) => setScene(event.target.value === customOptionValue ? "" : event.target.value)}
                  >
                    {sceneOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                    <option value={customOptionValue}>自定义输入</option>
                  </select>
                  {isCustomScene && (
                    <input className="custom-field-input" value={scene} onChange={(event) => setScene(event.target.value)} placeholder="输入自定义场景" />
                  )}
                </label>
              </div>

              <label className="field">
                <span>核心表达</span>
                <select
                  value={isCustomKeyMessage ? customOptionValue : keyMessage}
                  onChange={(event) => setKeyMessage(event.target.value === customOptionValue ? "" : event.target.value)}
                >
                  {keyMessageOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                  <option value={customOptionValue}>自定义输入</option>
                </select>
                {isCustomKeyMessage && (
                  <input className="custom-field-input" value={keyMessage} onChange={(event) => setKeyMessage(event.target.value)} placeholder="输入自定义核心表达" />
                )}
              </label>

              <label className="field">
                <span>画面标题</span>
                <input value={visibleText} onChange={(event) => setVisibleText(event.target.value)} placeholder="希望出现在图里的标题或短句" />
              </label>

              <label className="field">
                <span>避免内容</span>
                <select
                  value={isCustomAvoid ? customOptionValue : avoid}
                  onChange={(event) => setAvoid(event.target.value === customOptionValue ? "" : event.target.value)}
                >
                  {avoidOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                  <option value={customOptionValue}>自定义输入</option>
                </select>
                {isCustomAvoid && (
                  <input className="custom-field-input" value={avoid} onChange={(event) => setAvoid(event.target.value)} placeholder="输入自定义避免内容" />
                )}
              </label>

              <div className="recommendation-panel">
                <div>
                  <p className="eyebrow">智能建议</p>
                  <strong>
                    {findLabel(styleOptions, smartRecommendation.style)} · {findLabel(layoutOptions, smartRecommendation.layout)} ·{" "}
                    {findLabel(paletteOptions, smartRecommendation.palette)}
                  </strong>
                </div>
                <button className="secondary-button" type="button" onClick={applySmartRecommendation}>
                  应用建议
                </button>
              </div>
            </section>

            <button className="primary-button" disabled={isBusy || !topic.trim()} type="submit">
              {isBusy ? "正在生成" : "生成高清图片"}
            </button>

            {error && <p className="error-message">{error}</p>}
          </form>

          <section className={`result-surface ${showCaseGallery ? "is-start-mode" : ""}`} aria-live="polite">
            {showCaseGallery ? (
              <div className="start-studio">
                <header className="start-hero">
                  <p className="eyebrow">案例灵感</p>
                  <h2>从一个案例开始</h2>
                  <p>先借一束光，再长出自己的画面。</p>
                </header>

                <div className="case-gallery" aria-label="案例灵感库">
                  <div className="case-marquee" aria-label="自动滑动的案例">
                    <div className="case-track">
                      {[...caseStudies, ...caseStudies].map((item, index) => (
                        <article className="case-card" key={`${item.id}-${index}`} aria-hidden={index >= caseStudies.length}>
                          <button
                            className="case-image-button"
                            tabIndex={index >= caseStudies.length ? -1 : undefined}
                            type="button"
                            onClick={() => setPreviewCase(item)}
                          >
                            <img src={item.thumbnailUrl} alt={item.title} />
                            <span className="case-preview-chip">Preview</span>
                          </button>
                          <div className="case-card-copy">
                            <div className="case-tags">
                              <span>{findLabel(contentTypes, item.templateData.contentType)}</span>
                              <span>{findLabel(styleOptions, item.templateData.visualStyle)}</span>
                            </div>
                            <h3>{item.title}</h3>
                            <p>{item.description}</p>
                          </div>
                          <div className="case-card-actions">
                            <button
                              className="secondary-button"
                              tabIndex={index >= caseStudies.length ? -1 : undefined}
                              type="button"
                              onClick={() => setPreviewCase(item)}
                            >
                              Preview
                            </button>
                            <button
                              className="primary-button"
                              tabIndex={index >= caseStudies.length ? -1 : undefined}
                              type="button"
                              onClick={() => applyCaseTemplate(item)}
                            >
                              使用模板
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>

                <section className="inspiration-panel" aria-label="创意灵感面板">
                  <div className="inspiration-copy">
                    <p className="eyebrow">创意灵感</p>
                    <h2>不知道做什么？让系统先给你一个方向。</h2>
                    <p>点击后会随机生成主题、标题和下拉框配置，并同步到左侧表单。</p>
                    <button className="primary-button" type="button" onClick={applyCreativeInspiration}>
                      {currentInspiration ? "换一个灵感" : "生成灵感"}
                    </button>
                  </div>

                  <div className="inspiration-result">
                    {currentInspiration ? (
                      <>
                        <span>本次灵感</span>
                        <strong>{currentInspiration.title}</strong>
                        <p>{currentInspiration.description}</p>
                        <div className="inspiration-tags">
                          <span>{findLabel(contentTypes, currentInspiration.templateData.contentType)}</span>
                          <span>{findLabel(styleOptions, currentInspiration.templateData.visualStyle)}</span>
                          <span>{findLabel(layoutOptions, currentInspiration.templateData.layout)}</span>
                          <span>{currentInspiration.templateData.aspectRatio}</span>
                          <span>{currentInspiration.templateData.quality === "2k" ? "2K" : "标准"}</span>
                        </div>
                        <small>{currentInspiration.tip}</small>
                      </>
                    ) : (
                      <>
                        <span>准备就绪</span>
                        <strong>一键生成可编辑的创作方向</strong>
                        <p>灵感会填入主输入、画面标题、受众、场景、风格、布局、配色、比例和清晰度。</p>
                        <div className="inspiration-tags">
                          <span>主题</span>
                          <span>风格</span>
                          <span>布局</span>
                          <span>标题</span>
                          <span>画幅</span>
                        </div>
                        <small>生成后你可以继续微调，再点击左侧生成高清图片。</small>
                      </>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <>
                <div className="result-header">
                  <div>
                    <p className="eyebrow">输出画布</p>
                    <h2>{job ? getJobTitle(job) : "等待生成"}</h2>
                  </div>
                  <div className="result-actions">
                    {imageUrl && (
                      <a className="download-link" href={imageUrl} download={job ? buildDownloadName(job) : "banana2.png"}>
                        下载图片
                      </a>
                    )}
                    {imageUrl && (
                      <button className="secondary-button" type="button" onClick={() => setPreviewJob(job)}>
                        查看大图
                      </button>
                    )}
                  </div>
                </div>

                <div className="image-stage">
                  {imageUrl ? (
                    <img className="result-image" src={imageUrl} alt="生成结果" />
                  ) : isGenerating ? (
                    <div className="generating-canvas" role="status" aria-live="polite">
                      <div className="generating-blur" aria-hidden="true" />
                      <button className="generating-spinner-button" disabled type="button">
                        <span className="generating-spinner" aria-hidden="true" />
                        生成中
                      </button>
                      <div className="generating-copy">
                        <strong>正在努力生成，请耐心等待.....</strong>
                        <p>香蕉 2 正在处理画面细节，结果完成后会自动显示在这里。</p>
                      </div>
                      <div className="generating-steps" aria-hidden="true">
                        <span>解析主题</span>
                        <span>组织构图</span>
                        <span>渲染高清图</span>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-result">
                      <strong>{statusText}</strong>
                      <p>{job?.status === "failed" ? "本次请求失败，详细信息如下。" : "设置作品参数后，高清结果会铺在这里。"}</p>
                    </div>
                  )}
                </div>

                <div className="job-details">
                  <div>
                    <span>模型</span>
                    <strong>香蕉 2</strong>
                  </div>
                  <div>
                    <span>比例</span>
                    <strong>{job?.aspectRatio || aspectRatio}</strong>
                  </div>
                  <div>
                    <span>清晰度</span>
                    <strong>{job?.quality === "normal" ? "标准" : job?.quality || quality}</strong>
                  </div>
                  <div>
                    <span>尝试次数</span>
                    <strong>{job?.attempts ?? 0}</strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>{statusText}</strong>
                  </div>
                </div>

                {job?.error && <p className="error-message">{job.error}</p>}

              </>
            )}
          </section>
        </section>
      </section>

      {previewCase && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="案例预览">
          <div className="preview-dialog">
            <button className="preview-close" type="button" onClick={() => setPreviewCase(null)}>
              关闭
            </button>
            <img src={previewCase.thumbnailUrl} alt={previewCase.title} />
            <div className="preview-meta">
              <div>
                <span>案例信息</span>
                <p>{previewCase.title}</p>
              </div>
              <p>{previewCase.description}</p>
              <div className="project-summary">
                <div>
                  <span>类型</span>
                  <strong>{findLabel(contentTypes, previewCase.templateData.contentType)}</strong>
                </div>
                <div>
                  <span>风格</span>
                  <strong>{findLabel(styleOptions, previewCase.templateData.visualStyle)}</strong>
                </div>
                <div>
                  <span>布局</span>
                  <strong>{findLabel(layoutOptions, previewCase.templateData.layout)}</strong>
                </div>
                <div>
                  <span>配色</span>
                  <strong>{findLabel(paletteOptions, previewCase.templateData.palette)}</strong>
                </div>
                <div>
                  <span>比例</span>
                  <strong>{previewCase.templateData.aspectRatio}</strong>
                </div>
                <div>
                  <span>清晰度</span>
                  <strong>{previewCase.templateData.quality === "2k" ? "2K 高清" : "标准"}</strong>
                </div>
              </div>
              <div className="preview-actions">
                <button className="primary-button" type="button" onClick={() => applyCaseTemplate(previewCase)}>
                  使用此模板
                </button>
              </div>
              <small>套用后会填充左侧参数，不会自动提交生成。</small>
            </div>
          </div>
        </div>
      )}

      {previewJob?.outputUrl && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="作品预览">
          <div className="preview-dialog">
            <button className="preview-close" type="button" onClick={() => setPreviewJob(null)}>
              关闭
            </button>
            <img src={toAbsoluteResultUrl(previewJob.outputUrl) || previewJob.outputUrl} alt="作品预览" />
            <div className="preview-meta">
              <div>
                <span>作品信息</span>
                <p>{getJobTitle(previewJob)}</p>
              </div>
              {isProjectData(previewJob.projectData) && (
                <div className="project-summary">
                  <div>
                    <span>类型</span>
                    <strong>{findLabel(contentTypes, previewJob.projectData.contentType)}</strong>
                  </div>
                  <div>
                    <span>风格</span>
                    <strong>{findLabel(styleOptions, previewJob.projectData.visualStyle)}</strong>
                  </div>
                  <div>
                    <span>布局</span>
                    <strong>{findLabel(layoutOptions, previewJob.projectData.layout)}</strong>
                  </div>
                  <div>
                    <span>配色</span>
                    <strong>{findLabel(paletteOptions, previewJob.projectData.palette)}</strong>
                  </div>
                </div>
              )}
              <div className="preview-actions">
                <a href={toAbsoluteResultUrl(previewJob.outputUrl) || previewJob.outputUrl} download={buildDownloadName(previewJob)}>
                  下载图片
                </a>
              </div>
              <small>
                香蕉 2 · {previewJob.aspectRatio || "1:1"} · {previewJob.quality || "2k"} · {formatTime(previewJob.createdAt)}
              </small>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
