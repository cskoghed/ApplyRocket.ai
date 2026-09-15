import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { deleteDocumentRecord, readDocumentRecord } from "@/lib/document-store";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access documents." }, { status: 401 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { documentId } = await params;
  const document = await readDocumentRecord(documentId, user.id);

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { documentId } = await params;
  const deleted = await deleteDocumentRecord(documentId, user.id);
  return NextResponse.json({ deleted });
}
