import { Link, Route, Routes } from 'react-router'
import HostScreen from './pages/HostScreen'
import Home from './pages/Home'
import PlayScreen from './pages/PlayScreen'
import SetEditor from './pages/SetEditor'
import SetList from './pages/SetList'

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
      <Route path="/" element={<Home />} />
      <Route path="/sets" element={<SetList />} />
      <Route path="/sets/:id" element={<SetEditor />} />
      <Route path="/host/:code" element={<HostScreen />} />
      <Route path="/play/:code" element={<PlayScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
