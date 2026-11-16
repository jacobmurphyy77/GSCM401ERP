import type { Metadata } from "next";
import OperationsWorkspace from "@/src/components/operations-workspace";

export const metadata: Metadata = { title: "Employee Workspace · Wasatch Cycle Works" };

export default function EmployeePage() { return <OperationsWorkspace />; }
