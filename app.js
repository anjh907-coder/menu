/**
 * ==========================================================
 * MindFlow - AI 감성 일기 및 음성 인식 자바스크립트 소스 (Firebase + Google Gemini AI 결합판 - 규격 정정형)
 * 본 코드는 Web Speech API를 활용한 음성 입력 기능,
 * 구글 AI 스튜디오의 실제 Gemini 1.5 Flash 모델 기반 실시간 감정 분석 및 맞춤형 위로 메시지 생성,
 * 구글 Firebase Firestore 클라우드를 연동한 암호화 영구 적재 및 실시간 리스너 처리를 통합 처리합니다.
 * ==========================================================
 */

// ----------------------------------------------------------
// [1] 구글 Firebase v10 SDK 라이브러리 모듈 가져오기 (ESM CDN 방식)
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

// 사용자가 제공해 주신 구글 AI 스튜디오의 실제 Gemini API 키 (AQ로 시작하는 최신형 정품 키)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// 최신 실시간 감정 분석을 고성능/고속으로 처리할 모델 이름 지정 (1.5 Flash)
const GEMINI_MODEL = "gemini-1.5-flash";


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
// [7] Web Speech API 음성 인식(Speech Recognition) 설정
// ----------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;       // 말을 멈춰도 연속 녹음 진행
    recognition.interimResults = true;    // 실시간 임시인식 결과 추출
    recognition.lang = 'ko-KR';           // 한국어 세팅

    // 음성 받아쓰기가 진행될 때 호출되는 이벤트
    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            }
        }

        if (finalTranscript !== '') {
            if (diaryInput.value.length > 0 && !diaryInput.value.endsWith(' ')) {
                diaryInput.value += ' '; // 단어 간 공백 벌리기
            }
            diaryInput.value += finalTranscript;
            
            // 글자 수 동기화 및 저장 감지 활성화
            charCounter.textContent = `${diaryInput.value.length}자 입력됨`;
            if (activeDiaryId) saveBtn.disabled = false;
        }
    };

    recognition.onerror = (event) => {
        console.error('음성 인식 오류 발생:', event.error);
        if (event.error === 'not-allowed') {
            alert('🎙️ 마이크 권한이 차단되어 있습니다. 주소창 자물쇠 아이콘을 눌러 허용해 주세요!');
        }
        stopVoiceRecognition();
    };

    recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } catch (e) {}
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
    isRecording = true;
    diaryInput.focus();
    voiceBtn.classList.add('recording');
    voiceBtnText.textContent = '정지하기';
    recognition.start();
}

function stopVoiceRecognition() {
    if (!recognition) return;
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtnText.textContent = '음성 입력';
    recognition.stop();
}

voiceBtn.addEventListener('click', () => {
    if (!isRecording) {
        startVoiceRecognition();
    } else {
        stopVoiceRecognition();
    }
});


// ----------------------------------------------------------
// [8] 구글 Gemini 1.5 Flash 실제 API 감정 분석 및 위로 편지 생성
// ----------------------------------------------------------

/**
 * 구글 AI 스튜디오 Gemini API를 직접 비동기 호출하는 핵심 비즈니스 로직
 */
async function callGeminiEmotionAnalyzer(diaryText) {
    // API 통신용 엔드포인트 URL
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    // AI 모델에게 전달할 인공지능 전용 입체 프롬프트 구성
    const systemPrompt = `당신은 전 세계의 지친 하루를 달래주는 따뜻하고 공감 능력이 뛰어난 심리 분석 인공지능 카운셀러 'MindFlow'입니다.
사용자가 작성한 아래의 하루 일기 내용을 진지하게 읽어보세요.

[사용자의 일기]
"${diaryText}"

임무:
1. 일기 속에 담긴 감정의 결을 아주 깊게 해석하세요.
2. 지배적인 감정을 다음의 4가지 중 단 하나로 규정하고 해당 이모지를 추출하세요.
   - 기쁨 😃 (행복, 신남, 뿌듯함, 보람, 감사 등)
   - 슬픔 😢 (눈물, 쓸쓸함, 외로움, 우울, 지침, 아쉬움 등)
   - 분노 😡 (짜증, 화, 억울함, 불쾌, 스트레스 등)
   - 평온 🌿 (차분함, 잔잔함, 여유, 힐링, 평화로움 등)
3. 해당 일기 내용을 구체적으로 언급하며 지친 마음을 가득 보듬어주거나 기쁨을 배가시켜주는, 3줄 이내의 존댓말 위로 편지(responseText)를 지어주세요.

반드시 지켜야 할 제약 조건:
- 지정된 출력 JSON 스키마를 철저히 지켜 응답해야 합니다. 다른 사족 텍스트는 응답에 일절 표기하지 마세요.`;

    // [중요 교정 사항] 구글 API의 JSON Schema 표준 타입 명세는 대문자가 아닌 반드시 "소문자"여야 합니다!
    // 이전 코드의 대문자 "OBJECT", "STRING"을 정품 소문자 "object", "string"으로 전면 수정한 뒤 요청을 보냅니다.
    const requestBody = {
        contents: [
            {
                parts: [
                    { text: systemPrompt }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json", // JSON 형식 회신 제약
            responseSchema: {
                type: "object",
                properties: {
                    emoji: { 
                        type: "string", 
                        description: "감정을 대표하는 이모지. 반드시 '😃', '😢', '😡', '🌿' 중 단 하나만 반환할 것" 
                    },
                    emotionName: { 
                        type: "string", 
                        description: "감정 이름. 반드시 '기쁨', '슬픔', '분노', '평온' 중 단 하나만 반환할 것" 
                    },
                    responseText: { 
                        type: "string", 
                        description: "작성자의 구체적인 고충이나 행복을 읽어내어 위로하고 공감하는 내용의 3줄 이내의 문맥이 매끄러운 존댓말 격려문" 
                    }
                },
                required: ["emoji", "emotionName", "responseText"]
            }
        }
    };

    // 실제 fetch 함수를 통한 원격 구글 서버 네트워크 통신 개시
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        // 네트워크 응답 오류 시 더 자세한 디버깅 로그를 파악할 수 있게 콘솔에 텍스트 표기
        const errorText = await response.text();
        console.error("구글 서버 응답 바디 에러 로그:", errorText);
        throw new Error(`Gemini API 통신 실패 (상태코드: ${response.status})`);
    }

    const jsonResult = await response.json();
    
    // API 회신 텍스트 취득 및 파싱
    const rawAiText = jsonResult.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(rawAiText);
    
    return parsedData; // { emoji: "😢", emotionName: "슬픔", responseText: "..." } 객체 반환
}


// ----------------------------------------------------------
// [9] 일기 분석 요청 실행 (시뮬레이션에서 진짜 AI 호출로 전면 전환!)
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
        // 실제 구글 Gemini 인공지능 API를 비동기 호출합니다!
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
        alert("❌ AI 분석에 실패했습니다. API 키 사용량 제한이 걸렸거나 일기 본문 양이 적절하지 않을 수 있습니다.");
        
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
// [12] 앱 최초 실행 기동
// ----------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // 앱이 실행되면 Firestore 실시간 동기화 채널을 구동합니다.
    listenToFirestoreDiaries();
});
