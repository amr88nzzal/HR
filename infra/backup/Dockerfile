# حاوية النسخ الاحتياطي المجدولة: أدوات pg_dump/psql بنفس إصدار القاعدة + openssl + rclone
FROM postgres:18
RUN apt-get update \
 && apt-get install -y --no-install-recommends rclone openssl ca-certificates tar \
 && rm -rf /var/lib/apt/lists/*
COPY infra/backup/backup.sh infra/backup/restore-verify.sh infra/backup/backup-loop.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/backup-loop.sh"]
