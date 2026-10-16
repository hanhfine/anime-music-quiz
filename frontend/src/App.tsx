import { Link, Route, Routes } from 'react-router'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
