import { Link, Route, Routes } from 'react-router'
import { PopChip } from './components/PopPanel'
import HostScreen from './pages/HostScreen'
import Home from './pages/Home'
import PlayScreen from './pages/PlayScreen'
import SetEditor from './pages/SetEditor'
import SetList from './pages/SetList'

function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-6 p-8 pt-16 text-center">
      <PopChip as="h1" className="text-3xl">
        Không tìm thấy trang
      </PopChip>
      <Link className="font-semibold text-pop-lime underline" to="/">
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
