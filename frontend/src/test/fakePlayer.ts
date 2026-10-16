import { setPlayerFactoryForTests } from '../audio/createPlayer'
import { FakePlayer } from '../audio/FakePlayer'

// Mọi player tạo ra sau lời gọi này là FakePlayer (không tự phát); mảng trả về chứa chúng theo thứ tự tạo.
export function installFakePlayer(): FakePlayer[] {
  const created: FakePlayer[] = []
  setPlayerFactoryForTests((container) => {
    const player = new FakePlayer(container)
    created.push(player)
    return player
  })
  return created
}
