// Approved Student Email List for SY AI-DS 2026–27
// Division A (83 entries) and Division B (76 entries)
// Normalized, deduplicated, with preserved division memberships.

export interface Division {
  id: string;
  name: string;
  code: string;
  academicYear: string;
  department: string;
  status: 'active' | 'archived';
  description: string;
}

export interface ApprovedStudent {
  email: string;
  divisionIds: string[];
  status: 'authorized' | 'revoked';
  isRegistered: boolean;
  registeredUserId?: string;
  registeredName?: string;
  registeredUsername?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DivisionMembership {
  id: string;
  userId: string;
  divisionId: string;
  role: 'student' | 'cr' | 'faculty';
  joinedAt: string;
}

export const INSTITUTION_ID = '00000000-0000-4000-8000-000000000001';
export const DEPARTMENT_IDS = {
  computer: '00000000-0000-4000-8000-000000000011',
  informationTechnology: '00000000-0000-4000-8000-000000000012',
  electronics: '00000000-0000-4000-8000-000000000013',
  mechanical: '00000000-0000-4000-8000-000000000014',
  artificialIntelligence: '00000000-0000-4000-8000-000000000015',
} as const;
export const DIVISION_IDS = {
  a: '00000000-0000-4000-8000-000000000021',
  b: '00000000-0000-4000-8000-000000000022',
} as const;

export const DIVISIONS: Division[] = [
  {
    id: DIVISION_IDS.a,
    name: 'SY-A-DIVISION AI-DS 2026–27',
    code: 'SY-AIDS-A',
    academicYear: '2026–27',
    department: 'Artificial Intelligence & Data Science',
    status: 'active',
    description: 'Second Year Division A — B.Tech Artificial Intelligence & Data Science (Academic Year 2026–27)',
  },
  {
    id: DIVISION_IDS.b,
    name: 'SY-B-DIVISION AI-DS 2026–27',
    code: 'SY-AIDS-B',
    academicYear: '2026–27',
    department: 'Artificial Intelligence & Data Science',
    status: 'active',
    description: 'Second Year Division B — B.Tech Artificial Intelligence & Data Science (Academic Year 2026–27)',
  },
];

// Raw Division A list supplied by college
export const RAW_DIVISION_A_EMAILS: string[] = [
  'aarya.daddikar@somaiya.edu',
  'aditya.ladva@somaiya.edu',
  'advait.d@somaiya.edu',
  'ajitsingh.d@somaiya.edu',
  'anushka.bhor@somaiya.edu',
  'arghadeep.gupta@somaiya.edu',
  'arya.bohra@somaiya.edu',
  'asmi.jadhav@somaiya.edu',
  'ayush.kathiriya@somaiya.edu',
  'bbb@somaiya.edu',
  'bhagyashree.i@somaiya.edu',
  'bharati@somaiya.edu',
  'bhawish.k@somaiya.edu',
  'darshana.c@somaiya.edu',
  'deepali.c@somaiya.edu',
  'dev.ab@somaiya.edu',
  'devanandkb@somaiya.edu',
  'dheer.h@somaiya.edu',
  'dhruv.k@somaiya.edu',
  'dhurvi.joshi@somaiya.edu',
  'dp2@somaiya.edu',
  'gatik.godha@somaiya.edu',
  'gwadmare@somaiya.edu',
  'h.goswami@somaiya.edu',
  'harsh.kumar@somaiya.edu',
  'heer.dj@somaiya.edu',
  'heet.gm@somaiya.edu',
  'hemish.bhatt@somaiya.edu',
  'henvi.damani@somaiya.edu',
  'het.darji@somaiya.edu',
  'het.gor@somaiya.edu',
  'hiren.bafna@somaiya.edu',
  'hrishikesh.jadav@somaiya.edu',
  'isha.chudasma@somaiya.edu',
  'jahnavireddy.m@somaiya.edu',
  'jatan.mehta@somaiya.edu',
  'kaivalya.j@somaiya.edu',
  'keval.bharadwa@somaiya.edu',
  'kpashte@somaiya.edu',
  'krisha.db@somaiya.edu',
  'krushnakant.d@somaiya.edu',
  'kulkarni.sv@somaiya.edu',
  'manya.jain@somaiya.edu',
  'medha@somaiya.edu',
  'meet.kj@somaiya.edu',
  'mnemade@somaiya.edu',
  'mrinank.b@somaiya.edu',
  'neel.dungrani@somaiya.edu',
  'nilay.kelkar@somaiya.edu',
  'nilesh.gajre@somaiya.edu',
  'nishit.bangari@somaiya.edu',
  'omkar.rg@somaiya.edu',
  'palak.nj@somaiya.edu',
  'pankaj@somaiya.edu',
  'pjayshree062@gmail.com',
  'prachi.dhamecha@somaiya.edu',
  'pradnya28@somaiya.edu',
  'prashant.sb@somaiya.edu',
  'prathamesh.cc@somaiya.edu',
  'prathmesh.dhore@somaiya.edu',
  'pravin.patil@somaiya.edu',
  'rhutul.k@somaiya.edu',
  'rujal.bapat@somaiya.edu',
  'sachin.khant@somaiya.edu',
  'sarika@somaiya.edu',
  'sarth.jain@somaiya.edu',
  'satyam.sb@somaiya.edu',
  'sdhale@somaiya.edu',
  'shabbir.c@somaiya.edu',
  'sharwri.c@somaiya.edu',
  'shaurya.hd@somaiya.edu',
  'sheetaljagtap@somaiya.edu',
  'shreyas.chougale@somaiya.edu',
  'skasar@somaiya.edu',
  'sshah@somaiya.edu',
  'swarangi.borhade@somaiya.edu',
  'tanishq.g@somaiya.edu',
  'tanvir.bhere@somaiya.edu',
  'vanshika.khant@somaiya.edu',
  'vedant.masurkar@somaiya.edu',
  'vrushti.j@somaiya.edu',
  'vsagvekar@somaiya.edu',
  'yukti.bafna@somaiya.edu',
  'zain.ansari@somaiya.edu',
];

// Raw Division B list supplied by college
export const RAW_DIVISION_B_EMAILS: string[] = [
  'aayush.rudani@somaiya.edu',
  'adhish.t@somaiya.edu',
  'adhyan.sikroria@somaiya.edu',
  'aditya.thanki@somaiya.edu',
  'aksh.nagda@somaiya.edu',
  'akshat.sahu@somaiya.edu',
  'aryan.satasia@somaiya.edu',
  'ayush.salve@somaiya.edu',
  'b.sawant@somaiya.edu',
  'bhagyashree.i@somaiya.edu',
  'bharati@somaiya.edu',
  'bhargav.sah@somaiya.edu',
  'chaitrali.patil@somaiya.edu',
  'chirag.vadher@somaiya.edu',
  'darsh.t@somaiya.edu',
  'darsh.ved@somaiya.edu',
  'deepali.c@somaiya.edu',
  'dev10@somaiya.edu',
  'devanandkb@somaiya.edu',
  'devansh.u@somaiya.edu',
  'divy.s@somaiya.edu',
  'gwadmare@somaiya.edu',
  'hamood.s@somaiya.edu',
  'harshwardhan.vp@somaiya.edu',
  'heet.tanna@somaiya.edu',
  'henshi.m@somaiya.edu',
  'hetnileshbhai.s@somaiya.edu',
  'hs4@somaiya.edu',
  'kalpesh.bp@somaiya.edu',
  'kanish.trivedi@somaiya.edu',
  'keval.poriya@somaiya.edu',
  'kpashte@somaiya.edu',
  'krish.patel3@somaiya.edu',
  'krisha.at@somaiya.edu',
  'kshaunish.m@somaiya.edu',
  'lokesh.n@somaiya.edu',
  'mahir.sanghavi@somaiya.edu',
  'medha@somaiya.edu',
  'mitra.sapra@somaiya.edu',
  'mnemade@somaiya.edu',
  'mohit.dv@somaiya.edu',
  'neev.saraiya@somaiya.edu',
  'nidhi.ss@somaiya.edu',
  'nmp@somaiya.edu',
  'om.sanghavi@somaiya.edu',
  'osp@somaiya.edu',
  'paarth.sukhija@somaiya.edu',
  'pankaj@somaiya.edu',
  'panth.shah@somaiya.edu',
  'patel.dr@somaiya.edu',
  'pradnya28@somaiya.edu',
  'pranav.vn@somaiya.edu',
  'prashant.sb@somaiya.edu',
  'pravin.patil@somaiya.edu',
  'priya.thombare@somaiya.edu',
  'purva.mehta@somaiya.edu',
  'rishab.p@somaiya.edu',
  'rishi.singh1@somaiya.edu',
  'sahil.nikam@somaiya.edu',
  'samiksha.ns@somaiya.edu',
  'sanmesh.p@somaiya.edu',
  'santino.p@somaiya.edu',
  'sarika@somaiya.edu',
  'sdhale@somaiya.edu',
  'sheetaljagtap@somaiya.edu',
  'shikha.sp@somaiya.edu',
  'shyam.sondagar@somaiya.edu',
  'skasar@somaiya.edu',
  'sshah@somaiya.edu',
  'tanish.sanghavi@somaiya.edu',
  'tanisha.yr@somaiya.edu',
  'tanishka.thakur@somaiya.edu',
  'udit.pandey@somaiya.edu',
  'vaishnavi.ys@somaiya.edu',
  'vas3@somaiya.edu',
  'vedant.rathod@somaiya.edu',
  'vedant18@somaiya.edu',
  'vina.upadhye@somaiya.edu',
  'vinit.waghela@somaiya.edu',
  'vsagvekar@somaiya.edu',
  'yash.prabhu@somaiya.edu',
  'yatharth.shah@somaiya.edu',
  'yht@somaiya.edu',
  'yuvi.thacker@somaiya.edu',
];

export interface ApprovedDatasetReport {
  totalSuppliedDivisionA: number;
  totalSuppliedDivisionB: number;
  totalSuppliedEntries: number;
  uniqueAddressesOverall: number;
  sharedAddressesCount: number;
  sharedAddresses: string[];
  divisionAOnlyCount: number;
  divisionBOnlyCount: number;
  malformedAddresses: string[];
}

/**
 * Normalizes email address and validates RFC formatting
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmailFormat(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

/**
 * Builds the deduplicated ApprovedStudent map from the raw division lists.
 */
export function buildApprovedDataset(): {
  studentsMap: Map<string, ApprovedStudent>;
  report: ApprovedDatasetReport;
} {
  const studentsMap = new Map<string, ApprovedStudent>();
  const divASet = new Set<string>();
  const divBSet = new Set<string>();
  const malformed: string[] = [];
  const now = new Date().toISOString();

  // Process Division A
  for (const raw of RAW_DIVISION_A_EMAILS) {
    const norm = normalizeEmail(raw);
    if (!isValidEmailFormat(norm)) {
      malformed.push(raw);
      continue;
    }
    divASet.add(norm);
    studentsMap.set(norm, {
      email: norm,
      divisionIds: [DIVISION_IDS.a],
      status: 'authorized',
      isRegistered: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Process Division B
  for (const raw of RAW_DIVISION_B_EMAILS) {
    const norm = normalizeEmail(raw);
    if (!isValidEmailFormat(norm)) {
      malformed.push(raw);
      continue;
    }
    divBSet.add(norm);

    const existing = studentsMap.get(norm);
    if (existing) {
      // Overlapping email! Preserve both division memberships in single identity
      if (!existing.divisionIds.includes(DIVISION_IDS.b)) {
        existing.divisionIds.push(DIVISION_IDS.b);
      }
    } else {
      studentsMap.set(norm, {
        email: norm,
        divisionIds: [DIVISION_IDS.b],
        status: 'authorized',
        isRegistered: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const shared: string[] = [];
  divASet.forEach((email) => {
    if (divBSet.has(email)) {
      shared.push(email);
    }
  });

  const report: ApprovedDatasetReport = {
    totalSuppliedDivisionA: RAW_DIVISION_A_EMAILS.length,
    totalSuppliedDivisionB: RAW_DIVISION_B_EMAILS.length,
    totalSuppliedEntries: RAW_DIVISION_A_EMAILS.length + RAW_DIVISION_B_EMAILS.length,
    uniqueAddressesOverall: studentsMap.size,
    sharedAddressesCount: shared.length,
    sharedAddresses: shared.sort(),
    divisionAOnlyCount: divASet.size - shared.length,
    divisionBOnlyCount: divBSet.size - shared.length,
    malformedAddresses: malformed,
  };

  return { studentsMap, report };
}
