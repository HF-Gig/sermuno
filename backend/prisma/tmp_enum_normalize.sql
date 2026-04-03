DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'admin'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'ADMIN'
  ) THEN
    ALTER TYPE "UserRole" RENAME VALUE 'admin' TO 'ADMIN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'manager'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'MANAGER'
  ) THEN
    ALTER TYPE "UserRole" RENAME VALUE 'manager' TO 'MANAGER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'user'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'UserRole'
      AND e.enumlabel = 'USER'
  ) THEN
    ALTER TYPE "UserRole" RENAME VALUE 'user' TO 'USER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'low'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'LOW'
  ) THEN
    ALTER TYPE "ThreadPriority" RENAME VALUE 'low' TO 'LOW';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'normal'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'NORMAL'
  ) THEN
    ALTER TYPE "ThreadPriority" RENAME VALUE 'normal' TO 'NORMAL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'high'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadPriority'
      AND e.enumlabel = 'HIGH'
  ) THEN
    ALTER TYPE "ThreadPriority" RENAME VALUE 'high' TO 'HIGH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'new'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'NEW'
  ) THEN
    ALTER TYPE "ThreadStatus" RENAME VALUE 'new' TO 'NEW';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'in_progress'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'OPEN'
  ) THEN
    ALTER TYPE "ThreadStatus" RENAME VALUE 'in_progress' TO 'OPEN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'waiting'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'PENDING'
  ) THEN
    ALTER TYPE "ThreadStatus" RENAME VALUE 'waiting' TO 'PENDING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'done'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'CLOSED'
  ) THEN
    ALTER TYPE "ThreadStatus" RENAME VALUE 'done' TO 'CLOSED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'archived'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ThreadStatus'
      AND e.enumlabel = 'TRASH'
  ) THEN
    ALTER TYPE "ThreadStatus" RENAME VALUE 'archived' TO 'TRASH';
  END IF;
END $$;

ALTER TYPE "ThreadPriority" ADD VALUE IF NOT EXISTS 'URGENT';
ALTER TYPE "ThreadStatus" ADD VALUE IF NOT EXISTS 'SNOOZED';
