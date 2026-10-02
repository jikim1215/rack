// 클라이언트 page.tsx 는 metadata 를 내보낼 수 없어 제목만 이 서버 레이아웃이 맡는다.
export const metadata = { title: "비밀번호 변경" };

export default function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
