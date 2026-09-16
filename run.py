"""Entry point: `python run.py` starts the dashboard on 127.0.0.1:PORT and
opens it in the default browser.
"""
import threading
import webbrowser

import uvicorn

from backend import config


def _open_browser():
    webbrowser.open(f"http://{config.HOST}:{config.PORT}/")


def main():
    threading.Timer(1.5, _open_browser).start()
    uvicorn.run("backend.main:app", host=config.HOST, port=config.PORT, reload=False)


if __name__ == "__main__":
    main()
