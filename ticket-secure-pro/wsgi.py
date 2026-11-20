"""Point d'entrée WSGI : ``gunicorn wsgi:app``."""
from ticketsecure import create_app

app = create_app()

if __name__ == "__main__":
    import os
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
