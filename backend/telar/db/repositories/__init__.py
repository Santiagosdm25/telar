"""
Acceso a datos, organizado por dominio (ver los submódulos). Se mantiene
como paquete con re-export plano para que el resto del código siga
haciendo `from telar.db import repositories as repo` /
`repo.<funcion>(...)` sin cambios -- separar en archivos más chicos es
para quien lee/edita repositories, no un cambio de API pública.
"""

from telar.db.repositories.accounts import *  # noqa: F401,F403
from telar.db.repositories.audit import *  # noqa: F401,F403
from telar.db.repositories.auth import *  # noqa: F401,F403
from telar.db.repositories.bots import *  # noqa: F401,F403
from telar.db.repositories.conversations import *  # noqa: F401,F403
from telar.db.repositories.inboxes import *  # noqa: F401,F403
from telar.db.repositories.kb import *  # noqa: F401,F403
from telar.db.repositories.llm import *  # noqa: F401,F403
from telar.db.repositories.tenant_db import *  # noqa: F401,F403
from telar.db.repositories.tools import *  # noqa: F401,F403
