from app.config import Config, load_config


def test_load_config_reads_env():
    assert load_config({"YOUTUBE_API_KEY": " key-1 ", "YOUTUBE_REGION": "jp"}) == Config("key-1", "JP")


def test_load_config_defaults():
    assert load_config({}) == Config(youtube_api_key="", youtube_region="VN")
