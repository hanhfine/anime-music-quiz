import pytest

from app.services.title_cleaner import clean_title

# (tiêu đề YouTube, các phần dùng để tìm, nhãn gợi ý)
CASES = [
    ("Shingeki no Kyojin OP1 Full - Guren no Yumiya", ["Shingeki no Kyojin", "Guren no Yumiya"], "OP1"),
    ("【MAD】Naruto Shippuden Opening 16 - Silhouette", ["Naruto Shippuden", "Silhouette"], "OP16"),
    ("Demon Slayer: Kimetsu no Yaiba - Opening | Gurenge by LiSA", ["Demon Slayer: Kimetsu no Yaiba", "Gurenge by LiSA"], None),
    ("Jujutsu Kaisen - Opening 1 (HD)", ["Jujutsu Kaisen"], "OP1"),
    ("Tokyo Ghoul OP「unravel」TK from Ling tosite sigure", ["Tokyo Ghoul", "unravel", "TK from Ling tosite sigure"], None),
    ("Fullmetal Alchemist Brotherhood - Opening 1 | Again", ["Fullmetal Alchemist Brotherhood", "Again"], "OP1"),
    ("Made in Abyss OP - Deep in Abyss [Lyrics]", ["Made in Abyss", "Deep in Abyss"], None),
    ("NCOP - Chainsaw Man - KICK BACK", ["Chainsaw Man", "KICK BACK"], None),
    ("Spy x Family - Opening 2 - SOUVENIR by BUMP OF CHICKEN", ["Spy x Family", "SOUVENIR by BUMP OF CHICKEN"], "OP2"),
    ("Kaguya-sama: Love is War Opening Full - Love Dramatic", ["Kaguya-sama: Love is War", "Love Dramatic"], None),
    ("Steins;Gate OP - Hacking to the Gate (Full)", ["Steins;Gate", "Hacking to the Gate"], None),
    ("Code Geass Opening 1 - COLORS [1080p]", ["Code Geass", "COLORS"], "OP1"),
    ("Neon Genesis Evangelion - Opening (4K)", ["Neon Genesis Evangelion"], None),
    ("Your Lie in April ED 1 Full | Kirameki", ["Your Lie in April", "Kirameki"], "ED1"),
    ("Bocchi the Rock! ED 3 - Korogaru Iwa, Kimi ni Asa ga Furu", ["Bocchi the Rock!", "Korogaru Iwa, Kimi ni Asa ga Furu"], "ED3"),
    ("Re:Zero Season 2 Opening 1 | Realize - Konomi Suzuki", ["Re:Zero Season 2", "Realize", "Konomi Suzuki"], "OP1"),
    ("Mob Psycho 100 OP / 99 by MOB CHOIR", ["Mob Psycho 100", "99 by MOB CHOIR"], None),
    ("Cowboy Bebop - Opening - Tank! (HD)", ["Cowboy Bebop", "Tank!"], None),
    ("Haikyuu!! Season 4 OP 2 Full「Toppakou」SUPER BEAVER", ["Haikyuu!! Season 4", "Toppakou", "SUPER BEAVER"], "OP2"),
    ("Oshi no Ko - Opening | IDOL by YOASOBI (Creditless)", ["Oshi no Ko", "IDOL by YOASOBI"], None),
    ("Frieren ED 1 - Anytime Anywhere [NCED]", ["Frieren", "Anytime Anywhere"], "ED1"),
    ("Death Note - Opening 1 HD", ["Death Note"], "OP1"),
    ("Sword Art Online OP1 - crossing field (TV Size)", ["Sword Art Online", "crossing field"], "OP1"),
    ("Mushoku Tensei OP | Tabibito no Uta (Lyrics)", ["Mushoku Tensei", "Tabibito no Uta"], None),
    ("Hunter x Hunter 2011 Opening 1 Full / departure! by Masatoshi Ono", ["Hunter x Hunter 2011", "departure! by Masatoshi Ono"], "OP1"),
    ("Vinland Saga Season 2 ED 1 Official MV", ["Vinland Saga Season 2"], "ED1"),
    ("Toradora! OP 01 Pre-Parade", ["Toradora! Pre-Parade"], "OP1"),
    ("[AMV] Attack on Titan - Opening 7", ["Attack on Titan"], "OP7"),
    ("Kimi no Na wa / Your Name - Zenzenzense", ["Kimi no Na wa", "Your Name", "Zenzenzense"], None),
    ("Kono Subarashii Sekai ni Shukufuku wo! ED | Chiisana Boukensha", ["Kono Subarashii Sekai ni Shukufuku wo!", "Chiisana Boukensha"], None),
    ("Dragon Ball Z Opening (Cha-La Head-Cha-La) 1080p", ["Dragon Ball Z"], None),
    ("Blue Lock OP2 Full - Chaos ga Kiwamaru by UNISON SQUARE GARDEN", ["Blue Lock", "Chaos ga Kiwamaru by UNISON SQUARE GARDEN"], "OP2"),
    ("Lycoris Recoil", ["Lycoris Recoil"], None),
    ("Opening 1", [], "OP1"),
]


@pytest.mark.parametrize(("title", "parts", "label"), CASES)
def test_clean_title(title, parts, label):
    cleaned = clean_title(title)
    assert cleaned.parts == parts
    assert cleaned.label_hint == label


def test_duplicate_parts_are_dropped_ignoring_case():
    assert clean_title("Naruto - naruto | NARUTO").parts == ["Naruto"]
