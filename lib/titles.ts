/**
 * Fallback job titles.
 *
 * The real autocomplete source is Crustdata's Person Autocomplete endpoint,
 * which returns values that actually exist in their index. This list only
 * exists so the input still helps before a Crustdata key is configured, or if
 * that endpoint is briefly unavailable. It is deliberately short: it is a
 * convenience, not a taxonomy, and it is never used to validate anything.
 */
const FALLBACK_TITLES = [
  // Engineering
  "Software Engineer",
  "Senior Software Engineer",
  "Staff Software Engineer",
  "Principal Engineer",
  "Full Stack Engineer",
  "Full Stack Developer",
  "Frontend Engineer",
  "Front End Developer",
  "Backend Engineer",
  "Back End Developer",
  "Web Developer",
  "Mobile Engineer",
  "iOS Engineer",
  "Android Engineer",
  "Platform Engineer",
  "Infrastructure Engineer",
  "Site Reliability Engineer",
  "DevOps Engineer",
  "Cloud Engineer",
  "Security Engineer",
  "Systems Engineer",
  "Embedded Software Engineer",
  "Compiler Engineer",
  "Database Engineer",
  "Performance Engineer",
  "Developer Advocate",
  "Developer Experience Engineer",
  "Solutions Engineer",
  "Forward Deployed Engineer",
  "Founding Engineer",
  "Engineering Manager",
  "Director of Engineering",
  "VP of Engineering",
  "Chief Technology Officer",
  "Technical Lead",
  "Software Architect",
  "QA Engineer",
  "Test Engineer",
  "Automation Engineer",
  // Data and ML
  "Data Engineer",
  "Analytics Engineer",
  "Data Scientist",
  "Machine Learning Engineer",
  "Research Engineer",
  "Research Scientist",
  "AI Engineer",
  "Data Analyst",
  // Product and design
  "Product Manager",
  "Senior Product Manager",
  "Technical Product Manager",
  "Group Product Manager",
  "Product Designer",
  "UX Designer",
  "UI Designer",
  "UX Researcher",
  "Design Engineer",
  "Head of Product",
  "Head of Design",
  // Go to market and operations
  "Founder",
  "Co-Founder",
  "Chief of Staff",
  "Founder's Associate",
  "Operations Manager",
  "Business Operations Manager",
  "Account Executive",
  "Sales Engineer",
  "Customer Success Manager",
  "Growth Manager",
  "Marketing Manager",
  "Content Marketing Manager",
  "Recruiter",
  "Technical Recruiter",
  "Talent Partner",
  "Finance Manager",
  "Financial Analyst",
  "Project Manager",
  "Program Manager",
  "Technical Writer",
];

/** Prefix matches first, then anything containing the query. */
export function localTitleMatches(query: string, limit = 10): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return FALLBACK_TITLES.slice(0, limit);

  const prefix: string[] = [];
  const contains: string[] = [];

  for (const title of FALLBACK_TITLES) {
    const lower = title.toLowerCase();
    if (lower.startsWith(q)) prefix.push(title);
    else if (lower.includes(q)) contains.push(title);
  }

  return [...prefix, ...contains].slice(0, limit);
}
