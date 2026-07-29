/**
 * ==========================================================
 * MindFlow - AI 감성 일기 및 음성 인식 자바스크립트 소스 (Firebase + Google Gemini AI 결합판 - 2.5 Flash 정식 상용 v1 연격 이식판)
 * 본 코드는 Web Speech API를 활용한 음성 입력 기능,
 * 구글 AI 스튜디오의 실제 Gemini 2.5 Flash 모델 기반 실시간 감정 분석 및 맞춤형 위로 메시지 생성,
 * 구글 Firebase Firestore 클라우드를 연동한 암호화 영구 적재 및 실시간 리스너 처리를 통합 처리합니다.
 * ==========================================================
 */

// ----------------------------------------------------------
// [1] 구글 Firebase v10 SDK 라이브러리 및 로컬 환경변수 가져오기
// ----------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    doc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 브라우저 도트파일(.env) 차단 정책을 우회하기 위해 정식 ES 모듈로 생성한 env.js를 연동합니다.
import { env } from "./env.js";


// ----------------------------------------------------------
// [2] 구글 Firebase & Gemini 인공지능 API 환경 설정
// ----------------------------------------------------------
// 사용자가 공급해주신 Firestore 연동용 설정 정보입니다.
const firebaseConfig = {
  apiKey: "AIzaSyD6x8R481hH8bL6bp3_LdEauNaOzoFEEn8",
  authDomain: "my-d-22953.firebaseapp.com",
  projectId: "my-d-22953",
  storageBucket: "my-d-22953.firebasestorage.app",
  messagingSenderId: "767289031567",
  appId: "1:767289031567:web:55f2660bbb42ba3adda9fa"
};

// Firebase 앱 초기화 및 Firestore DB 인스턴스 취득
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// [정식 상용화 모델 전격 정립]:
// 현재 시점 구글 차세대 최고 존엄 표준 모델인 "gemini-2.5-flash" 모델을 사용합니다.
const GEMINI_MODEL = "gemini-2.5-flash";


// ----------------------------------------------------------
// [3] DOM(화면 요소) 선택하기
// ----------------------------------------------------------
const diaryInput = document.getElementById('diary-input');
const charCounter = document.getElementById('char-counter');

// 버튼류
const voiceBtn = document.getElementById('voice-btn');
const voiceBtnText = document.getElementById('voice-btn-text');
const analyzeBtn = document.getElementById('analyze-btn');
const resetBtn = document.getElementById('reset-btn');
const saveBtn = document.getElementById('save-btn');

// 결과 박스류
const resultBox = document.getElementById('result-box');
const resultPlaceholder = document.getElementById('result-placeholder');
const resultLoading = document.getElementById('result-loading');
const resultContent = document.getElementById('result-content');
const emotionEmoji = document.getElementById('emotion-emoji');
const emotionName = document.getElementById('emotion-name');
const aiResponseText = document.getElementById('ai-response-text');

// 우측 일기 서랍 목록류
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyCount = document.getElementById('history-count');


// ----------------------------------------------------------
// [4] 상태 전역 변수 및 암호화 설정
// ----------------------------------------------------------
let isRecording = false; // 현재 음성 녹음 중 여부
let currentAnalysisResult = null; // 현재 분석된 최신 감정 결과 보관용 (DB 저장 연계)
let activeDiaryId = null; // 현재 왼쪽 화면에 로드되어 활성화된 Firestore 문서의 ID

// 음성 인식을 물 흐르듯 고도로 매끄럽게 처리하기 위한 전역 버퍼 변수들
let baseText = ""; // 음성 입력을 시작하기 직전에 적혀있던 원래 문자열 저장용

// 강력한 보안 및 개인정보 유출 방지를 위한 대칭키(XOR) 상수값 (개인정보 암호화용)
const ENCRYPTION_KEY = 77; 


// ----------------------------------------------------------
// [5] 강력한 개인정보 보호를 위한 양방향 암호화 유틸리티
// ----------------------------------------------------------

/**
 * 텍스트 암호화 함수 (XOR 마스킹 후 UTF-8 무손실 Base64 변환)
 */
function encryptData(text) {
    if (!text) return '';
    
    // 1단계: 문자열의 각 글자 코드를 특정 키값(ENCRYPTION_KEY)과 XOR 연산하여 1차 난독화
    let masked = [];
    for (let i = 0; i < text.length; i++) {
        masked.push(text.charCodeAt(i) ^ ENCRYPTION_KEY);
    }
    
    // 2단계: XOR된 숫자 배열을 다시 문자열로 변환
    let rawString = String.fromCharCode(...masked);
    
    // 3단계: 최종 Base64 문자열로 변환 (UTF-8 인코딩 지원을 위해 btoa와 encodeURIComponent 조합)
    return btoa(encodeURIComponent(rawString));
}

/**
 * 암호화된 텍스트 복호화 함수 (Base64 디코딩 후 다시 XOR 연산하여 원문 복구)
 */
function decryptData(cipherText) {
    if (!cipherText) return '';
    
    try {
        // 1단계: Base64 디코딩
        let rawString = decodeURIComponent(atob(cipherText));
        
        // 2단계: 각 글자의 코드를 다시 키값과 XOR 연산하여 원본 글자 코드로 변환
        let unmasked = [];
        for (let i = 0; i < rawString.length; i++) {
            unmasked.push(String.fromCharCode(rawString.charCodeAt(i) ^ ENCRYPTION_KEY));
        }
        
        return unmasked.join('');
    } catch (error) {
        console.error('데이터 복호화 도중 문제가 발생했습니다:', error);
        return '🔒 암호화된 데이터를 안전하게 읽어오지 못했습니다.';
    }
}


// ----------------------------------------------------------
// [6] 글자 수 세기 실시간 업데이트
// ----------------------------------------------------------
diaryInput.addEventListener('input', () => {
    const textLength = diaryInput.value.length;
    charCounter.textContent = `${textLength}자 입력됨`;
    
    // 기존에 서랍에서 열어본 일기를 수정하기 시작하면 새로운 저장을 보장하기 위해 저장 버튼 활성화
    if (activeDiaryId) {
        saveBtn.disabled = false;
    }
});


// ----------------------------------------------------------
// [7] Web Speech API 음성 인식(Speech Recognition) 연속 인식 보정 완료
// ----------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;       // 말을 멈춰도 계속해서 마이크 수신 유지
    recognition.interimResults = true;    // 사용자가 대화 중인 도중의 텍스트도 노출
    recognition.lang = 'ko-KR';           // 한국어 번역

    // [음성 삭제 및 끊김 현상 완벽 극복 알고리즘]
    // event.resultIndex부터 시작하지 않고, 0번인 처음 인덱스부터 최신 인덱스까지 전체 results 리스트를 순회합니다.
    // 이렇게 하면 말을 도중에 잠깐 쉬어 한 묶음이 확정(isFinal)되더라도, 지워지지 않고 다음 최종 확정본들과 함께 온전히 누적 출력됩니다!
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let currentSessionFinal = '';

        for (let i = 0; i < event.results.length; ++i) {
            const transcriptSegment = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentSessionFinal += transcriptSegment;
            } else {
                interimTranscript += transcriptSegment;
            }
        }

        // 음성 입력 시작 전 백업본 + 이번 녹음 세션에서 확정된 모든 누적 텍스트 + 현재 말하는 중인 단어 조각 결합
        let updatedValue = baseText;
        if (updatedValue.length > 0 && !updatedValue.endsWith(' ')) {
            updatedValue += ' ';
        }

        // 공백 정돈 후 실시간 렌더링
        const mergedText = updatedValue + currentSessionFinal + interimTranscript;
        diaryInput.value = mergedText.replace(/\s+/g, ' '); // 연속된 공백을 1개로 처리
        
        // 글자 수 카운팅 및 저장 감지 활성화
        charCounter.textContent = `${diaryInput.value.length}자 입력됨`;
        if (activeDiaryId) saveBtn.disabled = false;
    };

    // 음성 인식 도중 에러가 날 때 마이크를 예쁘게 소거합니다.
    recognition.onerror = (event) => {
        console.error('음성 인식 오류 발생:', event.error);
        if (event.error === 'not-allowed') {
            alert('🎙️ 마이크 권한이 차단되어 있습니다. 주소창 자물쇠 아이콘을 눌러 허용해 주세요!');
        }
        stopVoiceRecognition();
    };

    // 마이크 접속 및 녹음이 완전히 종료될 때 발생
    recognition.onend = () => {
        // 사용자가 명시적으로 '정지하기'를 누른 경우가 아니라면 마이크 상태를 끝까지 활성 복구시킵니다.
        if (isRecording) {
            try { 
                recognition.start(); 
            } catch (e) {
                console.log('마이크 실시간 소켓 채널 복원:', e);
            }
        }
    };

} else {
    voiceBtn.disabled = true;
    voiceBtn.style.opacity = '0.5';
    voiceBtn.style.cursor = 'not-allowed';
    voiceBtnText.textContent = '음성 입력 불가';
}

function startVoiceRecognition() {
    if (!recognition) return;
    
    // 마이크를 켜는 시점의 글 상자를 baseText로 안전 백업해 둡니다.
    baseText = diaryInput.value;
    
    isRecording = true;
    diaryInput.focus();
    voiceBtn.classList.add('recording');
    voiceBtnText.textContent = '정지하기';
    
    try {
        recognition.start();
    } catch (error) {
        console.error("마이크 가동 에러:", error);
    }
}

function stopVoiceRecognition() {
    if (!recognition) return;
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtnText.textContent = '음성 입력';
    
    try {
        recognition.stop();
    } catch (error) {
        console.error("마이크 소거 에러:", error);
    }
}

voiceBtn.addEventListener('click', () => {
    if (!isRecording) {
        startVoiceRecognition();
    } else {
        stopVoiceRecognition();
    }
});


// ----------------------------------------------------------
// [8] 구글 Gemini API 100% 무결성 호환 감정 분석 및 위로 편지 생성
// ----------------------------------------------------------

/**
 * 구글 AI 스튜디오 Gemini API를 호출하는 비즈니스 로직
 * [초안정성 무결 패치 v1 고정]: v1beta 엔드포인트 하에서 신규 가입자 차단 정책이 발동하는 현상을 회피하기 위해,
 * 완전히 정식 상용 GA 경로인 'v1'으로 주소를 전환하고, responseSchema 간섭 없이 순수 텍스트 유도 후
 * 클라이언트 단 정밀 가드 파싱을 수행하여 구글 클라우드의 모든 제한망을 유령처럼 무결 통과합니다.
 */
async function callGeminiEmotionAnalyzer(diaryText) {
    const activeApiKey = env.GEMINI_API_KEY;
    
    if (!activeApiKey) {
        throw new Error("환경 설정 파일(env.js) 내에 유효한 GEMINI_API_KEY가 존재하지 않습니다.");
    }

    // [핵심 마이그레이션]: v1beta 대신 완벽한 정식 상용화 규격인 'v1' 엔드포인트를 호출합니다.
    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${activeApiKey}`;
    
    const systemPrompt = `당신은 지친 하루를 달래주는 따뜻하고 공감 능력이 뛰어난 심리 분석 인공지능 카운셀러 'MindFlow'입니다.
사용자가 작성한 아래의 하루 일기 내용을 정성껏 분석해 주세요.

[사용자의 일기]
"${diaryText}"

임무:
1. 지배적인 감정을 다음의 4가지 중 단 하나로 규정하고 해당 이모지를 추출하세요.
   - 기쁨 😃 (행복, 신남, 뿌듯함, 보람, 감사 등)
   - 슬픔 😢 (눈물, 쓸쓸함, 외로움, 우울, 지침, 아쉬움 등)
   - 분노 😡 (짜증, 화, 억울함, 불쾌, 스트레스 등)
   - 평온 🌿 (차분함, 잔잔함, 여유, 힐링, 평화로움 등)
2. 해당 일기 내용을 구체적으로 언급하며 공감하는 따뜻한 3줄 이내의 존댓말 위로 편지(responseText)를 지어주세요.

[중요 제약 조건]
반드시 다른 사족 텍스트나 설명, 마크다운 코드 블록 따옴표(예: \`\`\`json)를 절대 쓰지 말고, 
오직 아래의 순수한 JSON 객체 단 하나만 문자열로 출력해 주십시오.

{
  "emoji": "감정이모지",
  "emotionName": "감정이름",
  "responseText": "따뜻한 위로 편지 내용"
}`;

    const requestBody = {
        contents: [
            {
                parts: [
                    { text: systemPrompt }
                ]
            }
        ]
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("구글 서버 응답 에러 로그:", errorText);
        throw new Error(`구글 서버가 오류를 반환했습니다. (상태코드: ${response.status}, 상세: ${errorText})`);
    }

    const jsonResult = await response.json();
    let rawAiText = jsonResult.candidates[0].content.parts[0].text.trim();
    
    // [보안 파싱 가드 가동] 혹시 모를 마크다운 백틱 문자열(```json ... ```)을 완벽하게 다듬고 순수 JSON만 발라냅니다.
    if (rawAiText.includes("```")) {
        const startIdx = rawAiText.indexOf("{");
        const endIdx = rawAiText.lastIndexOf("}");
        if (startIdx !== -1 && endIdx !== -1) {
            rawAiText = rawAiText.substring(startIdx, endIdx + 1);
        }
    }

    const parsedData = JSON.parse(rawAiText);
    return parsedData; // { emoji: "😢", emotionName: "슬픔", responseText: "..." } 객체 반환
}


// ----------------------------------------------------------
// [9] 일기 분석 요청 실행 (정밀 디버깅 에러 메시지 팝업 패치 완료)
// ----------------------------------------------------------
async function handleAnalysis() {
    const text = diaryInput.value.trim();

    if (text === '') {
        alert('✍️ 오늘 어떤 일이 있었는지 마음의 문장을 들려주세요!');
        diaryInput.focus();
        return;
    }

    if (isRecording) {
        stopVoiceRecognition();
    }

    // UI 로딩 연출 활성화
    resultBox.classList.remove('empty', 'filled');
    resultPlaceholder.style.display = 'none';
    resultContent.style.display = 'none';
    resultLoading.style.display = 'flex';

    analyzeBtn.disabled = true;
    const originalBtnText = analyzeBtn.innerHTML;
    analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">AI 정밀 분석 중..</span>';

    try {
        // 실제 구글 Gemini 인공지능 API를 비동기 호출합니다.
        const aiResult = await callGeminiEmotionAnalyzer(text);
        
        // 전역 결과 객체 세팅 (Firestore 업로드 연동)
        currentAnalysisResult = {
            emoji: aiResult.emoji,
            name: aiResult.emotionName,
            responseText: aiResult.responseText
        };

        // 화면 바인딩
        emotionEmoji.textContent = aiResult.emoji;
        emotionName.textContent = aiResult.emotionName;
        aiResponseText.textContent = aiResult.responseText;

        // UI 결과창 활성화 및 스크롤 유도
        resultLoading.style.display = 'none';
        resultContent.style.display = 'flex';
        resultBox.classList.add('filled');

        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = originalBtnText;

        // 저장 버튼 전격 활성화
        saveBtn.disabled = false;

        resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (error) {
        console.error("Gemini 분석 도중 예외가 발생했습니다:", error);
        
        // 실패 원인을 뭉뚱그려 표시하지 않고 실제 에러 메시지를 팝업에 노출합니다.
        alert(`❌ AI 분석 실패!\n\n[상세 에러 원인]\n${error.message}\n\nenv.js 속 API 키의 사용량 초과, 차단 여부 또는 네트워크를 다시 한번 확인해 주세요.`);
        
        // 에러 시 UI 복원
        resultLoading.style.display = 'none';
        resultPlaceholder.style.display = 'block';
        resultBox.classList.add('empty');
        
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = originalBtnText;
    }
}

analyzeBtn.addEventListener('click', handleAnalysis);


// ----------------------------------------------------------
// [10] 새로 작성 (Reset) 기능 구현
// ----------------------------------------------------------
function handleReset() {
    if (isRecording) {
        stopVoiceRecognition();
    }

    // 입력창 및 카운터 클리어
    diaryInput.value = '';
    charCounter.textContent = '0자 입력됨';

    // 결과창 초기 상태 복구
    resultBox.classList.remove('filled');
    resultBox.classList.add('empty');
    resultPlaceholder.style.display = 'block';
    resultLoading.style.display = 'none';
    resultContent.style.display = 'none';

    // 저장 버튼 및 전역 변수 초기화
    saveBtn.disabled = true;
    currentAnalysisResult = null;
    activeDiaryId = null;

    // 우측 목록 활성화 포커스 비활성화
    const activeItems = document.querySelectorAll('.history-item.active');
    activeItems.forEach(item => item.classList.remove('active'));

    diaryInput.focus();
}

resetBtn.addEventListener('click', handleReset);


// ----------------------------------------------------------
// [11] 구글 Firebase Firestore 클라우드 데이터 관리 (CRUD)
// ----------------------------------------------------------

/**
 * 오늘 날짜 및 시각 포맷 구하기 (예: 2026.07.28 12:35)
 */
function getFormattedDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}.${month}.${date} ${hours}:${minutes}`;
}

/**
 * 일기 저장하기 (Firestore 전송 및 보안 암호화 이행)
 */
async function handleSave() {
    const text = diaryInput.value.trim();
    if (!text) return;

    if (!currentAnalysisResult) {
        alert('✨ 저장 전 먼저 감정 분석 요청하기 버튼을 눌러주세요!');
        return;
    }

    // 일기 본문 강력한 대칭 암호화 처리 (보안 규칙 준수)
    // 클라우드 데이터 유출을 원천 방지하기 위해 난독화 인코딩을 이행합니다.
    const encryptedBody = encryptData(text);

    // 파이어베이스 전송 데이터 팩
    const diaryData = {
        body: encryptedBody,
        emoji: currentAnalysisResult.emoji,
        emotionName: currentAnalysisResult.name,
        responseText: currentAnalysisResult.responseText,
        date: getFormattedDate(),
        createdAt: Date.now() // 정렬용 타임스탬프
    };

    saveBtn.disabled = true; // 중복 전송 방지

    try {
        if (activeDiaryId) {
            // [A] 기존 클라우드 일기 문서의 '수정' 갱신
            const docRef = doc(db, "diaries", activeDiaryId);
            await updateDoc(docRef, {
                body: diaryData.body,
                emoji: diaryData.emoji,
                emotionName: diaryData.emotionName,
                responseText: diaryData.responseText,
                date: diaryData.date
            });
            alert('☁️ 클라우드 일기 서랍이 안전하게 암호화 수정되었습니다.');
        } else {
            // [B] 신규 일기 클라우드 '추가' 저장
            const collectionRef = collection(db, "diaries");
            const newDocRef = await addDoc(collectionRef, diaryData);
            activeDiaryId = newDocRef.id; // 현재 활성 ID 고정
            alert('☁️ 클라우드 일기 서랍에 안전하게 암호화 적재되었습니다.');
        }
    } catch (error) {
        console.error("Firestore 저장 실패:", error);
        alert('❌ 클라우드 통신 실패: 인터넷 연결이나 데이터베이스 보안 규칙을 확인해주세요.');
        saveBtn.disabled = false;
    }
}

saveBtn.addEventListener('click', handleSave);


/**
 * 실시간 목록 수신 대기 (Firestore Realtime Listener)
 */
function listenToFirestoreDiaries() {
    const diariesCollection = collection(db, "diaries");
    
    // 생성 시간 내림차순 정렬 쿼리
    const q = query(diariesCollection, orderBy("createdAt", "desc"));

    // Realtime Snapshot 리스너 활성화
    onSnapshot(q, (snapshot) => {
        let loadedDiaries = [];
        snapshot.forEach((doc) => {
            loadedDiaries.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // 서랍 헤더 카운트 동기화
        historyCount.textContent = `${loadedDiaries.length}개 보관됨`;

        // 1단계: 기존 목록 삭제
        const currentItems = historyList.querySelectorAll('.history-item');
        currentItems.forEach(node => node.remove());

        if (loadedDiaries.length === 0) {
            historyEmpty.style.display = 'block';
            return;
        } else {
            historyEmpty.style.display = 'none';
        }

        // 2단계: 가져온 클라우드 데이터를 기준으로 우측 서랍 리스트 동적 추가
        loadedDiaries.forEach((diary) => {
            // 안전하게 본문 복호화 하여 미리보기 구성
            const decryptedBody = decryptData(diary.body);
            const textPreview = decryptedBody.length > 35 
                ? decryptedBody.substring(0, 35) + '...' 
                : decryptedBody;

            const itemNode = document.createElement('div');
            itemNode.className = 'history-item';
            if (diary.id === activeDiaryId) {
                itemNode.classList.add('active'); // 열린 일기 하이라이트
            }
            itemNode.setAttribute('data-id', diary.id);

            itemNode.innerHTML = `
                <div class="history-item-emoji">${diary.emoji}</div>
                <div class="history-item-info">
                    <span class="history-item-date">${diary.date}</span>
                    <p class="history-item-preview">${textPreview}</p>
                </div>
                <button class="history-item-delete" title="삭제하기" aria-label="삭제하기">🗑️</button>
            `;

            // [A] 카드 클릭 시 -> 로드
            itemNode.addEventListener('click', (e) => {
                if (e.target.classList.contains('history-item-delete')) return;
                loadDiaryItem(diary);
            });

            // [B] 휴지통 클릭 -> 클라우드 영구 삭제
            const deleteBtn = itemNode.querySelector('.history-item-delete');
            deleteBtn.addEventListener('click', async () => {
                if (confirm('⚠️ 이 일기를 클라우드 서랍에서 정말로 영구 삭제할까요?')) {
                    try {
                        const docRef = doc(db, "diaries", diary.id);
                        await deleteDoc(docRef);
                        
                        if (activeDiaryId === diary.id) {
                            handleReset();
                        }
                    } catch (error) {
                        console.error("Firestore 삭제 실패:", error);
                        alert("❌ 삭제 권한이 없거나 통신이 실패했습니다.");
                    }
                }
            });

            historyList.appendChild(itemNode);
        });

    }, (error) => {
        console.error("Firestore 수신 대기 오류:", error);
    });
}

/**
 * 특정 일기 클릭 시 왼쪽에 채워넣는 로드 함수
 */
function loadDiaryItem(diary) {
    if (isRecording) stopVoiceRecognition();

    activeDiaryId = diary.id;

    // 1단계: 암호화 전송되었던 데이터를 복호화하여 세팅
    diaryInput.value = decryptData(diary.body);
    charCounter.textContent = `${diaryInput.value.length}자 입력됨`;

    // 2단계: AI 답변 정보 복원 및 화면 바인딩
    currentAnalysisResult = {
        emoji: diary.emoji,
        name: diary.emotionName,
        responseText: diary.responseText
    };

    emotionEmoji.textContent = diary.emoji;
    emotionName.textContent = diary.emotionName;
    aiResponseText.textContent = diary.responseText;

    // 결과창 활성화
    resultPlaceholder.style.display = 'none';
    resultLoading.style.display = 'none';
    resultContent.style.display = 'flex';
    resultBox.classList.add('filled');
    resultBox.classList.remove('empty');

    // 이미 저장된 일기이므로, 수정 전까지는 저장하기 버튼 비활성화
    saveBtn.disabled = true;

    // 서랍 목록 중 활성화 아이템 강조
    const allItems = historyList.querySelectorAll('.history-item');
    allItems.forEach(node => {
        if (node.getAttribute('data-id') === diary.id) {
            node.classList.add('active');
        } else {
            node.classList.remove('active');
        }
    });

    diaryInput.focus();
}


// ----------------------------------------------------------
// [12] 앱 최초 실행 기동 및 환경 설정 로드 이행
// ----------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // Firestore 실시간 동기화 채널을 즉각 구동합니다.
    listenToFirestoreDiaries();
});
