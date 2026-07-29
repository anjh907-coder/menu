// Vercel 빌드 시점 환경변수 주입 도우미 스크립트
// 깃허브에는 API 키 원본이 올라가지 않으며, Vercel 빌드 시 대시보드에 적힌 키를 안전하게 꺼내와 env.js를 동적 생성합니다.
const fs = require('fs');

// Vercel 대시보드에서 불러온 API 키값 (없으면 빈 문자열 가드 작동)
const apiKey = process.env.GEMINI_API_KEY || "";

// 동적으로 생성해 줄 env.js 내부 텍스트 코드 조립
const envFileContent = `// Vercel 빌드 서버가 대시보드 환경변수(GEMINI_API_KEY)를 읽어와 자동 생성한 보안 파일입니다.
export const env = {
    GEMINI_API_KEY: "${apiKey}"
};
`;

try {
    // env.js 파일 쓰기 단행
    fs.writeFileSync('env.js', envFileContent, 'utf8');
    console.log('☁️ [Vercel Build] 대시보드 환경변수를 읽어 env.js 보안 파일을 성공적으로 조립/생성하였습니다!');
} catch (error) {
    console.error('❌ [Vercel Build] env.js 파일 자동 생성 중 오류가 터졌습니다:', error);
    process.exit(1); // 빌드 실패 전파
}
