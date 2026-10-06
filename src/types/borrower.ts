export interface Borrower {
  id: number;
  fullName: string;
  /** Alias collectors use, e.g. "Aling Nena sa palengke". */
  nickname: string | null;
  /** Stored normalised: "09XXXXXXXXX" or "+639XXXXXXXXX" (spaces/dashes removed). */
  phone: string | null;
  address: string | null;
  notes: string | null;
  /** Collection area / route; normalised (trimmed, collapsed whitespace), max 40 chars. */
  area: string | null;
  /** ISO timestamp; null means the borrower is active (archive = soft delete). */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields the user can enter. Empty optional fields are saved as NULL. */
export interface BorrowerInput {
  fullName: string;
  nickname?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  area?: string | null;
}

export interface GetBorrowersOptions {
  search?: string;
  includeArchived?: boolean;
  /** Exact area (case-insensitive); '' = borrowers with no area; omit/undefined = no filter. */
  area?: string;
}
