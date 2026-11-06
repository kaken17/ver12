
import "./style.css";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "./style.css";

// HTMLの部品を取得
const form = document.querySelector("#chat-form");
const questionInput = document.querySelector("#question");
const sendButton = document.querySelector("#send-button");
const messages = document.querySelector("#messages");
const statusText = document.querySelector("#status");
const stopButton = document.querySelector("#stop-button");
const avatar = document.querySelector("#avatar");
const mouth = document.querySelector("#mouth");
const avatarStatus = document.querySelector("#avatar-status");

// 会話履歴
const conversation = [];

let isLoading = false;

// 音声読み上げ対応確認
const speechSupported =
  "speechSynthesis" in window &&
  "SpeechSynthesisUtterance" in window;

// メッセージ表示
function addMessage(text, role) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;

  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;

  return bubble;
}

// 出典リンクを表示
function addSourcesToBubble(bubble, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return;
  }

  // URLの重複を除去
  const uniqueSources = [
    ...new Map(
      sources
        .filter((item) => item && typeof item.source === "string")
        .map((item) => [item.source, item])
    ).values()
  ];

  const section = document.createElement("div");
  section.className = "source-list";

  const heading = document.createElement("h4");
  heading.textContent = "参考資料・出典";
  section.appendChild(heading);

  uniqueSources.forEach((item) => {
    try {
      const url = new URL(item.source);

      // 安全なURLだけを許可
      if (!["https:", "http:"].includes(url.protocol)) {
        return;
      }

      const link = document.createElement("a");

      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || "参考ページを見る";

      const linkItem = document.createElement("div");
      linkItem.className = "source-item";

      linkItem.appendChild(link);
      section.appendChild(linkItem);

    } catch (error) {
      console.warn("無効な出典URL:", item.source);
    }
  });

  // 有効な出典がある場合だけ表示
  if (section.querySelector("a")) {
    bubble.appendChild(section);
    messages.scrollTop = messages.scrollHeight;
  }
}

// 音声読み上げ用の文章を整理
function cleanTextForSpeech(text) {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#~]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// 日本語音声読み上げ
function speakJapanese(text) {
  if (!speechSupported) {
    statusText.textContent =
      "このブラウザでは音声を利用できません";
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = "ja-JP";
  utterance.rate = 0.95;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();

  const japaneseVoice = voices.find(
    (voice) => voice.lang.toLowerCase() === "ja-jp"
  );

  if (japaneseVoice) {
    utterance.voice = japaneseVoice;
  }

  utterance.onstart = () => {
    avatar.classList.add("talking");
    mouth.classList.add("open");
    avatarStatus.textContent = "お話ししています…";
    statusText.textContent = "音声を再生中";
  };

  utterance.onend = () => {
    avatar.classList.remove("talking");
    mouth.classList.remove("open");
    avatarStatus.textContent = "あなたの学校案内係";
    statusText.textContent = "準備完了";
  };

  utterance.onerror = () => {
    avatar.classList.remove("talking");
    mouth.classList.remove("open");
    avatarStatus.textContent = "あなたの学校案内係";
    statusText.textContent = "音声を再生できませんでした";
  };

  window.speechSynthesis.speak(utterance);
}

// AIに質問を送信
async function askAI(question) {
  if (isLoading) return;

  isLoading = true;
  sendButton.disabled = true;
  questionInput.disabled = true;

  statusText.textContent = "学校の資料とWebを検索しています…";

  const loadingBubble = addMessage(
    "学校の資料とWebを検索しています…",
    "ai"
  );

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          ...conversation,
          {
            role: "user",
            content: question
          }
        ]
      })
    });

    const contentType =
      response.headers.get("content-type") || "";

    const responseText = await response.text();

    let data;

    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("JSON解析エラー:", responseText.slice(0, 500));
        throw new Error(
          "サーバーから正しいJSONが返されませんでした。"
        );
      }
    } else {
      console.error(
        "API応答エラー:",
        response.status,
        responseText.slice(0, 500)
      );

      throw new Error(
        `APIの応答形式が正しくありません（HTTP ${response.status}）。`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error || "AIとの通信に失敗しました。"
      );
    }

    if (
      typeof data.answer !== "string" ||
      !data.answer.trim()
    ) {
      throw new Error(
        "AIから回答が返ってきませんでした。"
      );
    }

    const answer = data.answer.trim();

    // 回答を表示
    const html = marked.parse(answer);

loadingBubble.innerHTML =
  DOMPurify.sanitize(html);

    // 出典リンクを回答の下に表示
    addSourcesToBubble(
      loadingBubble,
      data.sources || []
    );

    // 会話履歴に保存
    conversation.push(
      { role: "user", content: question },
      { role: "assistant", content: answer }
    );

    // 履歴を最大12件に制限
    if (conversation.length > 12) {
      conversation.splice(
        0,
        conversation.length - 12
      );
    }

    // 回答を音声で読み上げる
    const speechText = cleanTextForSpeech(answer);

    if (speechText) {
      speakJapanese(speechText);
    }

    statusText.textContent = "回答が完了しました";

  } catch (error) {
    loadingBubble.remove();

    console.error("AI通信エラー:", error);

    addMessage(
      "申し訳ありません。AIに接続できませんでした。\n\n" +
      (error.message || "時間をおいて、もう一度お試しください。"),
      "error"
    );

    statusText.textContent = "接続エラー";

  } finally {
    isLoading = false;
    sendButton.disabled = false;
    questionInput.disabled = false;
    questionInput.focus();
  }
}

// フォーム送信
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = questionInput.value.trim();

  if (!question || isLoading) return;

  addMessage(question, "user");

  questionInput.value = "";

  await askAI(question);
});

// 音声停止
stopButton.addEventListener("click", () => {
  if (speechSupported) {
    window.speechSynthesis.cancel();
  }

  avatar.classList.remove("talking");
  mouth.classList.remove("open");

  avatarStatus.textContent = "あなたの学校案内係";
  statusText.textContent = "音声を停止しました";
});

// 初期表示
if (!speechSupported) {
  statusText.textContent =
    "音声読み上げ非対応のブラウザです";
} else {
  statusText.textContent = "準備完了";
}
